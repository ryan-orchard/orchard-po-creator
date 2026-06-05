import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const [linesResult, posResult, itemsResult, suppliersResult, statusesResult] = await Promise.all([
    db.schema("orchard").from("po_lines").select("id, po_id, qty, unit_cost, item_id"),
    db.schema("orchard").from("purchase_orders").select("id, po_number, order_date, supplier_id, delivery_date"),
    db.schema("org_config").from("items").select("id, sku, name"),
    db.schema("org_config").from("suppliers").select("id, name, code"),
    db
      .schema("orchard_calcs")
      .from("po_line_statuses")
      .select(
        "po_line_id, status, expected_ship_date, expected_receive_date, actual_ship_date, cancelled_qty, notes"
      ),
  ]);

  if (linesResult.error)
    return NextResponse.json({ error: linesResult.error.message }, { status: 500 });

  const posMap = new Map((posResult.data ?? []).map((p) => [p.id, p]));
  const itemsMap = new Map((itemsResult.data ?? []).map((i) => [i.id, i]));
  const suppliersMap = new Map(
    (suppliersResult.data ?? []).map((s) => [s.id, { name: s.name as string, code: (s.code as string | null) ?? "" }])
  );
  const statusesMap = new Map((statusesResult.data ?? []).map((s) => [s.po_line_id, s]));

  // Build received_date map per po_line_id via the link table + receipts
  const poLineIds = (linesResult.data ?? []).map((l) => l.id as string);
  const receivedDateByLine = new Map<string, string>();

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
        .select("id, receipt_id")
        .in("id", receiptLineIds);

      const receiptIds = [...new Set((receiptLines ?? []).map((rl) => rl.receipt_id as string))];

      const { data: receipts } = receiptIds.length
        ? await db
            .schema("orchard")
            .from("receipts")
            .select("id, received_date")
            .in("id", receiptIds)
        : { data: [] };

      const receiptDateById = new Map(
        (receipts ?? []).map((r) => [r.id as string, r.received_date as string | null])
      );
      const receiptLineToReceipt = new Map(
        (receiptLines ?? []).map((rl) => [rl.id as string, rl.receipt_id as string])
      );

      for (const link of links) {
        const recId = receiptLineToReceipt.get(link.receipt_line_id as string);
        if (!recId) continue;
        const recDate = receiptDateById.get(recId);
        if (!recDate) continue;
        const existing = receivedDateByLine.get(link.po_line_id as string);
        // Keep the earliest received_date (first arrival for partial receipts)
        if (!existing || recDate < existing) {
          receivedDateByLine.set(link.po_line_id as string, recDate);
        }
      }
    }
  }

  const rows = (linesResult.data ?? []).map((line) => {
    const po = posMap.get(line.po_id as string);
    const item = itemsMap.get(line.item_id as string);
    const status = statusesMap.get(line.id as string);
    const qty = Number(line.qty) || 0;
    const unitCost = Number(line.unit_cost) || 0;
    return {
      poLineId: line.id as string,
      poId: line.po_id as string,
      poNumber: (po?.po_number as string) ?? "",
      orderDate: (po?.order_date as string | null) ?? null,
      poShipDate: (po?.delivery_date as string | null) ?? null,
      supplierName: po?.supplier_id ? suppliersMap.get(po.supplier_id as string)?.name ?? "" : "",
      supplierCode: po?.supplier_id ? suppliersMap.get(po.supplier_id as string)?.code ?? "" : "",
      itemSku: (item?.sku as string) ?? "",
      itemName: (item?.name as string) ?? "",
      qty,
      unitCost,
      lineTotal: qty * unitCost,
      lineState: (status?.status as string) ?? "ordered",
      expectedShipDate: (status?.expected_ship_date as string | null) ?? null,
      expectedReceiveDate: (status?.expected_receive_date as string | null) ?? null,
      actualShipDate: (status?.actual_ship_date as string | null) ?? null,
      receivedDate: receivedDateByLine.get(line.id as string) ?? null,
      cancelledQty: status?.cancelled_qty ? Number(status.cancelled_qty) : 0,
      notes: (status?.notes as string | null) ?? null,
    };
  });

  return NextResponse.json(rows);
}
