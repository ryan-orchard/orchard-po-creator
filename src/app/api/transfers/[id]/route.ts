import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

function rollUpTransferStatus(statuses: string[]): string {
  if (statuses.length === 0) return "in_transit";
  const active = statuses.filter((s) => s !== "cancelled");
  if (active.length === 0) return "cancelled";
  if (active.every((s) => s === "received")) return "received";
  if (active.some((s) => s === "received" || s === "partial")) return "partial";
  return "in_transit";
}

// GET /api/transfers/[id] — header + lines with match state.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: transfer, error } = await db
    .schema("orchard")
    .from("transfers")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !transfer) {
    return NextResponse.json({ error: "Transfer not found" }, { status: 404 });
  }

  const { data: linesData } = await db
    .schema("orchard")
    .from("transfer_lines")
    .select("*")
    .eq("transfer_id", id);
  const lines = linesData ?? [];
  const lineIds = lines.map((l) => l.id as string);
  const itemIds = [...new Set(lines.map((l) => l.item_id as string).filter(Boolean))];

  const { data: itemsData } = itemIds.length
    ? await db.schema("org_config").from("items").select("id, sku, name").in("id", itemIds)
    : { data: [] };
  const { data: locsData } = await db
    .schema("org_config")
    .from("locations")
    .select("id, code, name");
  const itemMap = new Map((itemsData ?? []).map((i) => [i.id, i]));
  const locMap = new Map((locsData ?? []).map((l) => [l.id, l]));

  let poNumber = "";
  if (transfer.po_id) {
    const { data: po } = await db
      .schema("orchard")
      .from("purchase_orders")
      .select("po_number")
      .eq("id", transfer.po_id)
      .maybeSingle();
    poNumber = (po?.po_number as string) ?? "";
  }

  // Match links per transfer line, with receipt-line detail hydrated.
  type MatchRow = {
    id: string;
    receiptLineId: string;
    matchedQty: number;
    matchMethod: string;
    confirmed: boolean;
    receipt: {
      source: string;
      receivedDate: string | null;
      warehouseCode: string | null;
      qtyReceived: number;
      sourceDocNo: string | null;
    } | null;
  };
  const linksByLine = new Map<string, MatchRow[]>();
  if (lineIds.length > 0) {
    const { data: links } = await db
      .schema("orchard_calcs")
      .from("transfer_line_receipt_line_links")
      .select("*")
      .in("transfer_line_id", lineIds);
    const rlIds = [...new Set((links ?? []).map((l) => l.receipt_line_id as string))];
    const { data: rls } = rlIds.length
      ? await db
          .schema("orchard_calcs")
          .from("receipt_lines")
          .select("id, source, received_date, warehouse_code, qty_received, source_doc_no")
          .in("id", rlIds)
      : { data: [] };
    const rlMap = new Map((rls ?? []).map((r) => [r.id, r]));
    for (const link of links ?? []) {
      const rl = rlMap.get(link.receipt_line_id as string);
      const arr = linksByLine.get(link.transfer_line_id as string) ?? [];
      arr.push({
        id: link.id as string,
        receiptLineId: link.receipt_line_id as string,
        matchedQty: Number(link.matched_qty) || 0,
        matchMethod: (link.match_method as string) ?? "manual",
        confirmed: Boolean(link.confirmed),
        receipt: rl
          ? {
              source: rl.source as string,
              receivedDate: (rl.received_date as string | null) ?? null,
              warehouseCode: (rl.warehouse_code as string | null) ?? null,
              qtyReceived: Number(rl.qty_received) || 0,
              sourceDocNo: (rl.source_doc_no as string | null) ?? null,
            }
          : null,
      });
      linksByLine.set(link.transfer_line_id as string, arr);
    }
  }

  // Line statuses — authoritative source for transfer status rollup.
  const { data: lineStatusRows } = lineIds.length
    ? await db
        .schema("orchard_calcs")
        .from("transfer_line_statuses")
        .select("transfer_line_id, status")
        .in("transfer_line_id", lineIds)
    : { data: [] };
  const lineStatusMap = new Map(
    (lineStatusRows ?? []).map((r) => [r.transfer_line_id as string, r.status as string])
  );
  const transferStatus = lineIds.length
    ? rollUpTransferStatus(lineIds.map((lid) => lineStatusMap.get(lid) ?? "in_transit"))
    : (transfer.status as string) ?? "in_transit";

  const fromLoc = locMap.get(transfer.from_location_id as string);
  const toLoc = locMap.get(transfer.to_location_id as string);

  const detailLines = lines.map((l) => {
    const item = itemMap.get(l.item_id as string);
    const matches = linksByLine.get(l.id as string) ?? [];
    const receivedQty = matches
      .filter((m) => m.confirmed)
      .reduce((sum, m) => sum + m.matchedQty, 0);
    const shippedQty = Number(l.shipped_qty) || 0;
    return {
      id: l.id as string,
      itemId: l.item_id as string,
      itemSku: (item?.sku as string) ?? "",
      itemName: (item?.name as string) ?? "",
      shippedQty,
      receivedQty,
      uom: (l.uom as string | null) ?? null,
      lotNumber: (l.lot_number as string | null) ?? null,
      poLineId: (l.po_line_id as string | null) ?? null,
      hasVariance: receivedQty > 0 && receivedQty !== shippedQty,
      lineStatus: lineStatusMap.get(l.id as string) ?? "in_transit",
      matches,
    };
  });

  // Freight total — sum of freight movement_costs on this transfer's movements.
  let freightTotal = 0;
  if (lineIds.length > 0) {
    const { data: movs } = await db
      .schema("orchard_calcs")
      .from("movements")
      .select("id")
      .eq("source_doc_type", "transfer_line")
      .in("source_doc_id", lineIds);
    const movIds = (movs ?? []).map((m) => m.id as string);
    if (movIds.length > 0) {
      const { data: costs } = await db
        .schema("orchard_calcs")
        .from("movement_costs")
        .select("amount, cost_type")
        .in("movement_id", movIds);
      freightTotal = (costs ?? [])
        .filter((c) => c.cost_type === "freight")
        .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    }
  }

  return NextResponse.json({
    id: transfer.id,
    transferNumber: transfer.transfer_number,
    poId: (transfer.po_id as string | null) ?? null,
    poNumber,
    fromLocationId: transfer.from_location_id,
    fromCode: (fromLoc?.code as string) ?? "",
    fromName: (fromLoc?.name as string) ?? "",
    toLocationId: transfer.to_location_id,
    toCode: (toLoc?.code as string) ?? "",
    toName: (toLoc?.name as string) ?? "",
    carrier: (transfer.carrier as string | null) ?? null,
    shipDate: transfer.ship_date,
    expectedArrivalDate: (transfer.expected_arrival_date as string | null) ?? null,
    status: transferStatus,
    notes: (transfer.notes as string | null) ?? null,
    freightTotal,
    lines: detailLines,
  });
}

// PATCH /api/transfers/[id] — edit header fields.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();

  const fieldMap: Record<string, string> = {
    poId: "po_id",
    fromLocationId: "from_location_id",
    toLocationId: "to_location_id",
    carrier: "carrier",
    shipDate: "ship_date",
    expectedArrivalDate: "expected_arrival_date",
    notes: "notes",
  };

  const updates: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in body) updates[col] = body[key] ?? null;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { error } = await db.schema("orchard").from("transfers").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Re-sync the projected movements with the new header by touching the
  // lines — that re-fires the transfer_lines -> movements trigger.
  await db
    .schema("orchard")
    .from("transfer_lines")
    .update({ updated_at: new Date().toISOString() })
    .eq("transfer_id", id);

  return NextResponse.json({ success: true, id });
}
