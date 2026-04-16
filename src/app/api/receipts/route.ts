import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { generateNextNumber } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  const [receiptsResult, linesResult, itemsResult, locsResult, posResult] = await Promise.all([
    db.schema("orchard").from("receipts").select("*").order("received_date", { ascending: false }),
    db.schema("orchard").from("receipt_lines").select("*"),
    db.schema("org_config").from("items").select("id, sku"),
    db.schema("org_config").from("locations").select("id, code, name"),
    db.schema("orchard").from("purchase_orders").select("id, po_number"),
  ]);

  if (receiptsResult.error) return NextResponse.json({ error: receiptsResult.error.message }, { status: 500 });

  const itemMap = new Map((itemsResult.data ?? []).map((i) => [i.id, i.sku as string]));
  const locMap = new Map((locsResult.data ?? []).map((l) => [l.id, (l.code ?? l.name) as string]));
  const poMap = new Map((posResult.data ?? []).map((p) => [p.id, p.po_number as string]));

  // Group lines by receipt
  type RL = { id: string; receipt_id: string; item_id: string; qty_received: number; three_pl_sku: string | null; lot_number: string | null };
  const lineMap: Record<string, RL[]> = {};
  for (const l of (linesResult.data ?? []) as RL[]) {
    if (!lineMap[l.receipt_id]) lineMap[l.receipt_id] = [];
    lineMap[l.receipt_id].push(l);
  }

  type Receipt = {
    id: string; receipt_number: string; received_date: string; location_id: string;
    po_id: string | null; external_id: string | null; stord_receipt_id: string | null;
  };

  const receipts = (receiptsResult.data as Receipt[]).map((r) => ({
    id: r.id,
    receiptNumber: r.receipt_number,
    receivedDate: r.received_date,
    purchaseOrder: r.po_id ? poMap.get(r.po_id) ?? null : null,
    purchaseOrderId: r.po_id,
    warehouse: locMap.get(r.location_id) ?? null,
    warehouseId: r.location_id,
    externalReceiptId: r.external_id,
    stordReceiptId: r.stord_receipt_id,
    lines: (lineMap[r.id] ?? []).map((l) => ({
      id: l.id,
      sku: itemMap.get(l.item_id) ?? null,
      skuId: l.item_id,
      qtyReceived: Number(l.qty_received),
      threePlSku: l.three_pl_sku,
      lotNumber: l.lot_number,
    })),
  }));

  return NextResponse.json(receipts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const receiptNumber = await generateNextNumber("RCP");

  // Resolve location by code if facilityCode provided instead of warehouseId
  let locationId = body.warehouseId ?? null;
  if (!locationId && body.facilityCode) {
    const { data: locs } = await db
      .schema("org_config")
      .from("locations")
      .select("id")
      .eq("code", body.facilityCode)
      .limit(1);
    if (locs && locs.length > 0) locationId = locs[0].id;
  }

  const { data: receipt, error: receiptError } = await db
    .schema("orchard")
    .from("receipts")
    .insert({
      receipt_number: receiptNumber,
      received_date: body.receivedDate,
      location_id: locationId,
      source: body.source ?? "Manual",
      external_id: body.externalReceiptId ?? null,
      notes: body.notes ?? null,
      po_id: body.purchaseOrderId ?? null,
    })
    .select("id")
    .single();

  if (receiptError || !receipt) {
    return NextResponse.json({ error: receiptError?.message ?? "Failed to create receipt" }, { status: 500 });
  }

  // Create receipt lines
  if (body.lineItems && body.lineItems.length > 0) {
    const lineRows = (body.lineItems as {
      skuId?: string; qtyReceived: number; threePlSku?: string;
      lotNumber?: string; poLineItemId?: string;
    }[]).map((item) => ({
      receipt_id: receipt.id,
      item_id: item.skuId ?? null,
      qty_received: item.qtyReceived,
      three_pl_sku: item.threePlSku ?? null,
      lot_number: item.lotNumber ?? null,
      status: "Open",
    }));

    const { data: insertedLines, error: lineError } = await db
      .schema("orchard")
      .from("receipt_lines")
      .insert(lineRows)
      .select("id");

    if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });

    // Create PO line → receipt line links for any pre-matched lines
    const linkedLines = (body.lineItems as { poLineItemId?: string }[])
      .map((item, i) => ({ poLineItemId: item.poLineItemId, receiptLineId: insertedLines?.[i]?.id }))
      .filter((x) => x.poLineItemId && x.receiptLineId);

    if (linkedLines.length > 0) {
      await db.schema("orchard_calcs").from("po_line_receipt_line_links").insert(
        linkedLines.map((x) => ({
          po_line_id: x.poLineItemId,
          receipt_line_id: x.receiptLineId,
          linked_by: "Ryan Belanger",
        }))
      );
    }
  }

  if (body.purchaseOrderId) {
    logActivity({
      poId: body.purchaseOrderId,
      action: "receipt_created",
      description: `Receipt ${receiptNumber} created`,
      actor: "Ryan Belanger",
      relatedRecordType: "receipt",
      relatedRecordId: receipt.id,
    });
  }

  return NextResponse.json({ id: receipt.id, receiptNumber });
}
