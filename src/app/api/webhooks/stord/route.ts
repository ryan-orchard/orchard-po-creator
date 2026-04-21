import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/lib/supabase";
import { generateNextNumber } from "@/lib/sequence";
import { SKU_MAPPING, resolveFacilityCode } from "@/lib/client-config";
import { logActivity } from "@/lib/activity-log";
import { attemptPOMatch } from "@/lib/po-matching";

interface ReceiptLineItem {
  sku: string;
  quantity: string;
  lot_number: string | null;
  expires_at: string | null;
  damages: string | null;
}

interface ReceiptConfirmationPayload {
  type: string;
  data: {
    receipt_confirmation_id: string;
    received_at: string;
    facility_id: string;
    order: {
      order_number: string;
      type: string;
    };
    receipt_confirmation_line_items: ReceiptLineItem[];
    bol: string | null;
    confirmation_number: string | null;
  };
}

// Tell Next.js not to pre-parse the body — we need the raw string for Svix verification
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.STORD_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STORD_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  // Read raw body — required for Svix signature verification
  const rawBody = await request.text();

  // Verify signature — Stord uses webhook-* headers (Svix also supports svix-*)
  const msgId = request.headers.get("webhook-id") ?? request.headers.get("svix-id");
  const msgTimestamp = request.headers.get("webhook-timestamp") ?? request.headers.get("svix-timestamp");
  const msgSignature = request.headers.get("webhook-signature") ?? request.headers.get("svix-signature");

  if (!msgId || !msgTimestamp || !msgSignature) {
    return NextResponse.json({ error: "Missing Svix headers" }, { status: 400 });
  }

  let payload: ReceiptConfirmationPayload;
  try {
    const wh = new Webhook(secret);
    payload = wh.verify(rawBody, {
      "svix-id": msgId,
      "svix-timestamp": msgTimestamp,
      "svix-signature": msgSignature,
    }) as ReceiptConfirmationPayload;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Only handle receipt confirmation events
  if (!payload.type.includes("receipt_confirmation.created")) {
    return NextResponse.json({ received: true, skipped: true, type: payload.type });
  }

  const { data } = payload;

  try {
    const stordReceiptId = data.receipt_confirmation_id;
    const orderNum = data.order?.order_number || "";

    // Idempotency — check by stord_receipt_id first
    const { data: existingByStordId } = await db
      .schema("orchard")
      .from("receipts")
      .select("id")
      .eq("stord_receipt_id", stordReceiptId)
      .maybeSingle();

    if (existingByStordId) {
      console.log(`Receipt ${stordReceiptId} already exists — skipping`);
      return NextResponse.json({ received: true, skipped: true, reason: "duplicate", id: stordReceiptId });
    }

    // Check by external_id / order number
    if (orderNum) {
      const normalizedOrder = orderNum.replace(/^Order:\s*/i, "").trim();
      const { data: existingReceipts } = await db
        .schema("orchard")
        .from("receipts")
        .select("id, external_id")
        .not("external_id", "is", null);

      for (const r of existingReceipts ?? []) {
        const normalizedExt = ((r.external_id as string) || "").replace(/^Order:\s*/i, "").trim();
        if (normalizedExt === normalizedOrder || normalizedExt === orderNum) {
          console.log(`Receipt with order ${orderNum} already exists — skipping`);
          return NextResponse.json({ received: true, skipped: true, reason: "duplicate", orderNumber: orderNum });
        }
      }
    }

    // Resolve warehouse location_id
    const facilityCode = resolveFacilityCode(data.facility_id);
    const { data: warehouse } = await db
      .schema("org_config")
      .from("locations")
      .select("id")
      .eq("code", facilityCode)
      .maybeSingle();
    const locationId = warehouse?.id ?? null;

    // Generate receipt number
    const receiptNumber = await generateNextNumber("RCP");

    // Resolve Supabase item UUIDs — batch lookup by standardSku
    const standardSkus = data.receipt_confirmation_line_items
      .map((item) => SKU_MAPPING[item.sku]?.standardSku)
      .filter(Boolean) as string[];

    const { data: itemsData } = standardSkus.length > 0
      ? await db.schema("org_config").from("items").select("id, sku").in("sku", standardSkus)
      : { data: [] };
    const skuToId = new Map((itemsData ?? []).map((i) => [i.sku as string, i.id as string]));

    // Attempt PO match from order number
    let resolvedPoId: string | null = null;
    if (orderNum) {
      const { data: allPOs } = await db
        .schema("orchard")
        .from("purchase_orders")
        .select("id, po_number");
      const poList = (allPOs ?? []).map((p) => ({ id: p.id as string, poNumber: p.po_number as string }));
      const matchedPO = attemptPOMatch(orderNum, poList);
      if (matchedPO) resolvedPoId = matchedPO.id;
    }

    const externalId = orderNum || stordReceiptId;

    // Create receipt header
    const { data: receipt, error: receiptError } = await db
      .schema("orchard")
      .from("receipts")
      .insert({
        receipt_number: receiptNumber,
        received_date: data.received_at.split("T")[0],
        external_id: externalId,
        stord_receipt_id: stordReceiptId,
        source: "Stord",
        ...(locationId ? { location_id: locationId } : {}),
        ...(resolvedPoId ? { po_id: resolvedPoId } : {}),
        ...(data.bol ? { notes: `BOL: ${data.bol}` } : {}),
      })
      .select("id")
      .single();

    if (receiptError || !receipt) {
      throw new Error(`Failed to create receipt: ${receiptError?.message}`);
    }

    // Create receipt lines
    const lines = data.receipt_confirmation_line_items.map((item) => {
      const standardSku = SKU_MAPPING[item.sku]?.standardSku;
      const itemId = standardSku ? (skuToId.get(standardSku) ?? null) : null;
      return {
        receipt_id: receipt.id,
        item_id: itemId,
        qty_received: parseFloat(item.quantity) || 0,
        three_pl_sku: item.sku,
        lot_number: item.lot_number ?? null,
        status: "Unmatched",
      };
    });

    if (lines.length > 0) {
      const { error: linesError } = await db.schema("orchard").from("receipt_lines").insert(lines);
      if (linesError) console.error("Failed to insert receipt lines:", linesError);
    }

    // Log activity against PO if matched
    if (resolvedPoId) {
      const totalQty = data.receipt_confirmation_line_items.reduce(
        (sum, item) => sum + (parseFloat(item.quantity) || 0),
        0
      );
      logActivity({
        poId: resolvedPoId,
        action: "receipt_created",
        description: `Receipt ${receiptNumber} received at ${facilityCode} — ${totalQty} units via Stord webhook`,
        actor: "Orchard AI",
        relatedRecordType: "receipt",
        relatedRecordId: receipt.id,
      });
    }

    console.log(`Created receipt ${receiptNumber} from webhook (${stordReceiptId})`);
    return NextResponse.json({ received: true, receiptNumber });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
