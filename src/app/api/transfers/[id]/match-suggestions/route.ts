import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

// GET /api/transfers/[id]/match-suggestions
// For each transfer line, suggest receipt lines that could match it:
// same item, landing at the transfer's destination warehouse.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: transfer, error } = await db
    .schema("orchard")
    .from("transfers")
    .select("id, to_location_id, expected_arrival_date")
    .eq("id", id)
    .single();
  if (error || !transfer) {
    return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  }

  const { data: toLoc } = await db
    .schema("org_config")
    .from("locations")
    .select("code")
    .eq("id", transfer.to_location_id)
    .maybeSingle();
  const warehouseCode = (toLoc?.code as string | null) ?? null;

  const { data: linesData } = await db
    .schema("orchard")
    .from("transfer_lines")
    .select("id, item_id, shipped_qty")
    .eq("transfer_id", id);
  const lines = linesData ?? [];

  // Already-confirmed received qty per line.
  const lineIds = lines.map((l) => l.id as string);
  const receivedByLine = new Map<string, number>();
  if (lineIds.length > 0) {
    const { data: links } = await db
      .schema("orchard_calcs")
      .from("transfer_line_receipt_line_links")
      .select("transfer_line_id, matched_qty, confirmed")
      .in("transfer_line_id", lineIds);
    for (const l of links ?? []) {
      if (!l.confirmed) continue;
      const k = l.transfer_line_id as string;
      receivedByLine.set(k, (receivedByLine.get(k) ?? 0) + (Number(l.matched_qty) || 0));
    }
  }

  // Candidate receipt lines at the destination warehouse for the items shipped.
  const itemIds = [...new Set(lines.map((l) => l.item_id as string).filter(Boolean))];
  let receiptLines: Record<string, unknown>[] = [];
  if (warehouseCode && itemIds.length > 0) {
    const { data: rls } = await db
      .schema("orchard_calcs")
      .from("receipt_lines")
      .select(
        "id, item_id, source, received_date, warehouse_code, qty_received, source_doc_no, lot_number"
      )
      .eq("warehouse_code", warehouseCode)
      .in("item_id", itemIds)
      .order("received_date", { ascending: false });
    receiptLines = rls ?? [];
  }

  const suggestions = lines.map((line) => {
    const shippedQty = Number(line.shipped_qty) || 0;
    const receivedQty = receivedByLine.get(line.id as string) ?? 0;
    const candidates = receiptLines
      .filter((rl) => rl.item_id === line.item_id)
      .map((rl) => ({
        receiptLineId: rl.id as string,
        source: rl.source as string,
        receivedDate: (rl.received_date as string | null) ?? null,
        warehouseCode: (rl.warehouse_code as string | null) ?? null,
        qtyReceived: Number(rl.qty_received) || 0,
        sourceDocNo: (rl.source_doc_no as string | null) ?? null,
        lotNumber: (rl.lot_number as string | null) ?? null,
      }));
    return {
      transferLineId: line.id as string,
      itemId: line.item_id as string,
      shippedQty,
      receivedQty,
      fullyReceived: receivedQty >= shippedQty && shippedQty > 0,
      candidates,
    };
  });

  return NextResponse.json({ warehouseCode, suggestions });
}
