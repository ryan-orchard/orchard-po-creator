import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { getRecords, createRecord, createRecords, TABLES } from "@/lib/airtable";
import { getMaxSequenceNumber } from "@/lib/sequence";
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

  // Only handle receipt confirmation events (Svix may or may not prefix with "v1.")
  if (!payload.type.includes("receipt_confirmation.created")) {
    return NextResponse.json({ received: true, skipped: true, type: payload.type });
  }

  const { data } = payload;

  try {
    // Idempotency — skip if we've already processed this receipt
    // Check UUID, order number, and normalized variants as External Receipt ID
    const orderNum = data.order?.order_number || "";
    const existingReceipts = await getRecords(TABLES.RECEIPTS);
    const existingExternalIds = new Set(
      existingReceipts
        .map((r) => r.fields["External Receipt ID"] as string)
        .filter(Boolean)
    );

    // Check UUID
    if (existingExternalIds.has(data.receipt_confirmation_id)) {
      console.log(`Receipt ${data.receipt_confirmation_id} already exists — skipping`);
      return NextResponse.json({ received: true, skipped: true, reason: "duplicate", id: data.receipt_confirmation_id });
    }
    // Check order number and common variants (e.g., "Order: PO-123" vs "PO-123")
    if (orderNum) {
      const normalizedOrder = orderNum.replace(/^Order:\s*/i, "").trim();
      for (const extId of existingExternalIds) {
        const normalizedExt = extId.replace(/^Order:\s*/i, "").trim();
        if (normalizedExt === normalizedOrder || normalizedExt === orderNum) {
          console.log(`Receipt with order ${orderNum} already exists (matched ${extId}) — skipping`);
          return NextResponse.json({ received: true, skipped: true, reason: "duplicate", orderNumber: orderNum });
        }
      }
    }

    // Resolve warehouse
    const facilityCode = resolveFacilityCode(data.facility_id);
    const warehouses = await getRecords(TABLES.WAREHOUSES, {
      filterByFormula: `{Code} = "${facilityCode}"`,
    });
    const warehouseId = warehouses[0]?.id ?? null;

    // Generate receipt number (reuse existingReceipts from dedup check above)
    const maxNum = getMaxSequenceNumber(existingReceipts, "Receipt Number", "RCP");
    const receiptNumber = `RCP-${maxNum + 1}`;

    // Create receipt header — use order number as External Receipt ID (the linkable thread),
    // fall back to receipt_confirmation_id if no order number available
    const externalId = data.order?.order_number || data.receipt_confirmation_id;
    const receiptFields: Record<string, unknown> = {
      "Receipt Number": receiptNumber,
      "Received Date": data.received_at.split("T")[0],
      "External Receipt ID": externalId,
      "Stord Receipt ID": data.receipt_confirmation_id,
      ...(warehouseId ? { Warehouses: [warehouseId] } : {}),
      ...(data.bol ? { Notes: `BOL: ${data.bol}` } : {}),
    };

    const receipt = await createRecord(TABLES.RECEIPTS, receiptFields);

    // Build line items — map Stord SKUs to our standard SKUs
    const lineItemRecords = data.receipt_confirmation_line_items.map((item, index) => {
      const mapping = SKU_MAPPING[item.sku];
      return {
        fields: {
          "Line ID": `${receiptNumber}-${index + 1}`,
          Receipt: [receipt.id],
          ...(mapping?.airtableId ? { SKU: [mapping.airtableId] } : {}),
          "Qty Received": parseFloat(item.quantity) || 0,
          "3PL SKU": item.sku,
          "Match Status": "Open",
          ...(item.lot_number ? { "Lot Number": item.lot_number } : {}),
        },
      };
    });

    if (lineItemRecords.length > 0) {
      await createRecords(TABLES.RECEIPT_LINES, lineItemRecords);
    }

    // Log activity against PO if we can resolve the order number
    if (data.order?.order_number) {
      const allPOs = await getRecords(TABLES.PURCHASE_ORDERS);
      const poList = allPOs.map((p) => ({
        id: p.id,
        poNumber: (p.fields["PO Number"] as string) || "",
      }));
      const matchedPO = attemptPOMatch(data.order.order_number, poList);
      if (matchedPO) {
        const totalQty = data.receipt_confirmation_line_items.reduce(
          (sum, item) => sum + (parseFloat(item.quantity) || 0),
          0
        );
        logActivity({
          poId: matchedPO.id,
          action: "receipt_created",
          description: `Receipt ${receiptNumber} received at ${facilityCode} — ${totalQty} units via Stord webhook`,
          actor: "Orchard AI",
          relatedRecordType: "receipt",
          relatedRecordId: receipt.id,
        });
      }
    }

    console.log(`Created receipt ${receiptNumber} from webhook (${data.receipt_confirmation_id})`);
    return NextResponse.json({ received: true, receiptNumber });
  } catch (error) {
    console.error("Webhook processing error:", error);
    // Return 500 so Svix retries delivery
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
