import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Fetch PO header and lines
    const [poResult, linesResult] = await Promise.all([
      db.schema("orchard").from("purchase_orders").select("po_number").eq("id", id).single(),
      db.schema("orchard").from("po_lines").select("id, item_id, qty, cost_basis").eq("po_id", id),
    ]);

    if (poResult.error || !poResult.data) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }

    const poLines = linesResult.data ?? [];
    const poLineIds = poLines.map((l) => l.id as string);

    // Fetch item details for UOM info
    const itemIds = [...new Set(poLines.map((l) => l.item_id as string))];
    const { data: itemsData } = itemIds.length
      ? await db.schema("org_config").from("items").select("id, sku, unit_of_measure, sticks_per_carton, metadata").in("id", itemIds)
      : { data: [] };
    const itemMap = new Map((itemsData ?? []).map((i) => [i.id, i]));

    // Fetch linked receipt lines via link table and sum qty_received per po_line
    const receivedByLine: Record<string, number> = {};
    const receiptDates: string[] = [];

    if (poLineIds.length > 0) {
      const { data: links } = await db
        .schema("orchard_calcs")
        .from("po_line_receipt_line_links")
        .select("po_line_id, receipt_line_id")
        .in("po_line_id", poLineIds);

      if (links && links.length > 0) {
        const receiptLineIds = [...new Set(links.map((l) => l.receipt_line_id as string))];

        const { data: receiptLines } = await db
          .schema("orchard")
          .from("receipt_lines")
          .select("id, receipt_id, qty_received")
          .in("id", receiptLineIds);

        // Map receipt_line_id → po_line_id
        const linkMap = new Map(links.map((l) => [l.receipt_line_id, l.po_line_id]));
        for (const rl of receiptLines ?? []) {
          const poLineId = linkMap.get(rl.id as string);
          if (poLineId) {
            receivedByLine[poLineId] = (receivedByLine[poLineId] ?? 0) + Number(rl.qty_received);
          }
        }

        // Get receipt dates
        const receiptIds = [...new Set((receiptLines ?? []).map((l) => l.receipt_id as string))];
        if (receiptIds.length > 0) {
          const { data: receipts } = await db
            .schema("orchard")
            .from("receipts")
            .select("received_date")
            .in("id", receiptIds);
          for (const r of receipts ?? []) {
            if (r.received_date) receiptDates.push(r.received_date);
          }
          receiptDates.sort();
        }
      }
    }

    // Build per-line result
    const uomSet = new Set<string>();
    type Item = { id: string; sku: string; unit_of_measure: string; sticks_per_carton: number | null; metadata: Record<string, unknown> | null };
    const result = poLines.map((l) => {
      const item = itemMap.get(l.item_id as string) as Item | undefined;
      const uom = item?.unit_of_measure ?? "Each";
      uomSet.add(uom);
      const qtyOrdered = Number(l.qty);
      const qtyReceived = receivedByLine[l.id as string] ?? 0;

      return {
        id: l.id,
        skuId: l.item_id,
        sku: item
          ? {
              standardSku: item.sku,
              flavor: (item.metadata as Record<string, unknown>)?.flavor ?? null,
              uom,
              count: item.sticks_per_carton ?? null,
              category: (item.metadata as Record<string, unknown>)?.category ?? null,
            }
          : null,
        section: null,
        qtyOrdered,
        qtyCartons: uom === "Carton" ? qtyOrdered : null,
        qtyReceived,
        qtyRemaining: Math.max(0, qtyOrdered - qtyReceived),
      };
    });

    const uomLabel =
      uomSet.size === 1 && uomSet.has("Carton")
        ? "cartons"
        : uomSet.size === 1 && uomSet.has("Stick")
        ? "sticks"
        : "units";

    return NextResponse.json({
      poId: id,
      poNumber: poResult.data.po_number,
      lineItems: result,
      receiptDates,
      uomLabel,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch receipt status" }, { status: 500 });
  }
}
