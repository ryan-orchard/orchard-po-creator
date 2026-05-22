import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { generateNextNumber } from "@/lib/sequence";

// GET /api/transfers — flat, line-level rows (one row per transfer line).
export async function GET() {
  const [transfersResult, linesResult, itemsResult, locationsResult, posResult] =
    await Promise.all([
      db.schema("orchard").from("transfers").select("*").order("ship_date", { ascending: false }),
      db.schema("orchard").from("transfer_lines").select("*"),
      db.schema("org_config").from("items").select("id, sku, name"),
      db.schema("org_config").from("locations").select("id, code, name"),
      db.schema("orchard").from("purchase_orders").select("id, po_number"),
    ]);

  if (transfersResult.error)
    return NextResponse.json({ error: transfersResult.error.message }, { status: 500 });

  const transfersMap = new Map((transfersResult.data ?? []).map((t) => [t.id, t]));
  const itemsMap = new Map((itemsResult.data ?? []).map((i) => [i.id, i]));
  const locationsMap = new Map((locationsResult.data ?? []).map((l) => [l.id, l]));
  const posMap = new Map((posResult.data ?? []).map((p) => [p.id, p]));

  // Received qty per transfer line — sum of confirmed match links.
  const lineIds = (linesResult.data ?? []).map((l) => l.id as string);
  const receivedByLine = new Map<string, number>();
  if (lineIds.length > 0) {
    const { data: links } = await db
      .schema("orchard_calcs")
      .from("transfer_line_receipt_line_links")
      .select("transfer_line_id, matched_qty, confirmed")
      .in("transfer_line_id", lineIds);
    for (const link of links ?? []) {
      if (!link.confirmed) continue;
      const id = link.transfer_line_id as string;
      receivedByLine.set(id, (receivedByLine.get(id) ?? 0) + (Number(link.matched_qty) || 0));
    }
  }

  const rows = (linesResult.data ?? []).map((line) => {
    const t = transfersMap.get(line.transfer_id as string);
    const item = itemsMap.get(line.item_id as string);
    const fromLoc = t ? locationsMap.get(t.from_location_id as string) : undefined;
    const toLoc = t ? locationsMap.get(t.to_location_id as string) : undefined;
    const po = t?.po_id ? posMap.get(t.po_id as string) : undefined;
    const shippedQty = Number(line.shipped_qty) || 0;
    const receivedQty = receivedByLine.get(line.id as string) ?? 0;
    return {
      transferLineId: line.id as string,
      transferId: line.transfer_id as string,
      transferNumber: (t?.transfer_number as string) ?? "",
      fromCode: (fromLoc?.code as string) ?? "",
      fromName: (fromLoc?.name as string) ?? "",
      toCode: (toLoc?.code as string) ?? "",
      toName: (toLoc?.name as string) ?? "",
      itemSku: (item?.sku as string) ?? "",
      itemName: (item?.name as string) ?? "",
      shippedQty,
      receivedQty,
      uom: (line.uom as string | null) ?? null,
      shipDate: (t?.ship_date as string | null) ?? null,
      expectedArrivalDate: (t?.expected_arrival_date as string | null) ?? null,
      carrier: (t?.carrier as string | null) ?? null,
      status: (t?.status as string) ?? "in_transit",
      hasVariance: receivedQty > 0 && receivedQty !== shippedQty,
      poId: (t?.po_id as string | null) ?? null,
      poNumber: (po?.po_number as string) ?? "",
      lotNumber: (line.lot_number as string | null) ?? null,
    };
  });

  return NextResponse.json(rows);
}

// POST /api/transfers — create a transfer header + lines.
export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await request.json();

  type LineInput = {
    itemId: string;
    poLineId?: string | null;
    shippedQty: number;
    uom?: string | null;
    lotNumber?: string | null;
  };
  const lines: LineInput[] = body.lines ?? [];

  if (!body.fromLocationId || !body.toLocationId || !body.shipDate) {
    return NextResponse.json(
      { error: "fromLocationId, toLocationId and shipDate are required" },
      { status: 400 }
    );
  }
  if (body.fromLocationId === body.toLocationId) {
    return NextResponse.json({ error: "From and to locations must differ" }, { status: 400 });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "At least one line is required" }, { status: 400 });
  }

  const transferNumber = await generateNextNumber("TR");

  const { data: transfer, error: headerError } = await db
    .schema("orchard")
    .from("transfers")
    .insert({
      transfer_number: transferNumber,
      po_id: body.poId || null,
      from_location_id: body.fromLocationId,
      to_location_id: body.toLocationId,
      carrier: body.carrier || null,
      ship_date: body.shipDate,
      expected_arrival_date: body.expectedArrivalDate || null,
      status: "in_transit",
      notes: body.notes || null,
      created_by: "Ryan Belanger",
    })
    .select("id")
    .single();

  if (headerError || !transfer) {
    return NextResponse.json(
      { error: headerError?.message ?? "Failed to create transfer" },
      { status: 500 }
    );
  }

  const lineRows = lines.map((l) => ({
    transfer_id: transfer.id,
    po_line_id: l.poLineId || null,
    item_id: l.itemId,
    shipped_qty: l.shippedQty,
    uom: l.uom || null,
    lot_number: l.lotNumber || null,
  }));

  const { error: lineError } = await db.schema("orchard").from("transfer_lines").insert(lineRows);
  if (lineError) {
    return NextResponse.json({ error: lineError.message }, { status: 500 });
  }

  return NextResponse.json({ id: transfer.id, transferNumber });
}
