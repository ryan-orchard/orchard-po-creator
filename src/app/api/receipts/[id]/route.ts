import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [receiptResult, linesResult] = await Promise.all([
      db.schema("orchard").from("receipts").select("*").eq("id", id).single(),
      db.schema("orchard").from("receipt_lines").select("*").eq("receipt_id", id),
    ]);

    if (receiptResult.error || !receiptResult.data) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    const r = receiptResult.data as Record<string, unknown>;
    const lines = linesResult.data ?? [];

    // Fetch items, locations, and PO in parallel
    const itemIds = [...new Set(lines.map((l) => l.item_id as string).filter(Boolean))];
    const [itemsResult, locResult, posResult, availableItemsResult] = await Promise.all([
      itemIds.length
        ? db.schema("org_config").from("items").select("id, sku, unit_of_measure").in("id", itemIds)
        : { data: [] },
      db.schema("org_config").from("locations").select("id, code, name").eq("id", r.location_id as string).single(),
      r.po_id
        ? db.schema("orchard").from("purchase_orders").select("id, po_number").eq("id", r.po_id as string).single()
        : { data: null },
      db.schema("org_config").from("items").select("id, sku").eq("is_active", true).order("sku"),
    ]);

    const itemMap = new Map((itemsResult.data ?? []).map((i) => [i.id, i]));
    const loc = locResult.data;
    const po = posResult.data;

    // Check which receipt lines are linked to PO lines
    const lineIds = lines.map((l) => l.id as string);
    const { data: links } = lineIds.length
      ? await db.schema("orchard_calcs").from("po_line_receipt_line_links").select("receipt_line_id").in("receipt_line_id", lineIds)
      : { data: [] };
    const matchedLineIds = new Set((links ?? []).map((l) => l.receipt_line_id as string));

    type Item = { id: string; sku: string; unit_of_measure: string };
    const mappedLines = lines.map((l) => {
      const item = itemMap.get(l.item_id as string) as Item | undefined;
      return {
        id: l.id,
        skuId: l.item_id ?? null,
        sku: item?.sku ?? null,
        uom: item?.unit_of_measure ?? null,
        qtyReceived: Number(l.qty_received) || 0,
        threePlSku: l.three_pl_sku ?? null,
        lotNumber: l.lot_number ?? null,
        matched: matchedLineIds.has(l.id as string),
      };
    });

    const availableItems = (availableItemsResult.data ?? []).map((i) => ({
      id: i.id,
      standardSku: i.sku,
    }));

    return NextResponse.json({
      id: r.id,
      receiptNumber: r.receipt_number,
      receivedDate: r.received_date,
      externalReceiptId: r.external_id ?? null,
      stordReceiptId: r.stord_receipt_id ?? null,
      notes: r.notes ?? null,
      purchaseOrder: po?.po_number ?? null,
      purchaseOrderId: po?.id ?? null,
      warehouse: loc ? (loc.code ?? loc.name) : null,
      warehouseId: r.location_id,
      lines: mappedLines,
      availableItems,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to get receipt: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = {};
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.externalReceiptId !== undefined) updates.external_id = body.externalReceiptId;
  if (body.receivedDate !== undefined) updates.received_date = body.receivedDate;
  if (body.warehouseId !== undefined) updates.location_id = body.warehouseId || null;
  if (body.purchaseOrderId !== undefined) updates.po_id = body.purchaseOrderId || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await db.schema("orchard").from("receipts").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // receipt_lines cascade on delete via FK
    const { error } = await db.schema("orchard").from("receipts").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to delete: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
