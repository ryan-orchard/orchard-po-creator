import { db } from "@/lib/supabase";

/**
 * Recalculate PO status based on receipt coverage across all po_lines.
 * Updates orchard_calcs.po_statuses in place.
 * Returns the new status string.
 */
export async function recalcPoStatus(poId: string): Promise<string> {
  const { data: poLines } = await db
    .schema("orchard")
    .from("po_lines")
    .select("id, qty")
    .eq("po_id", poId);

  if (!poLines || poLines.length === 0) return "Issued";

  const poLineIds = poLines.map((pl) => pl.id as string);

  const { data: links } = await db
    .schema("orchard_calcs")
    .from("po_line_receipt_line_links")
    .select("po_line_id, receipt_line_id")
    .in("po_line_id", poLineIds);

  const linkedReceiptLineIds = (links ?? []).map((l) => l.receipt_line_id as string);
  const receivedByPoLine = new Map<string, number>();

  if (linkedReceiptLineIds.length > 0) {
    const { data: receiptLines } = await db
      .schema("orchard")
      .from("receipt_lines")
      .select("id, qty_received")
      .in("id", linkedReceiptLineIds);

    const receiptLineQty = new Map(
      (receiptLines ?? []).map((rl) => [rl.id as string, Number(rl.qty_received) || 0])
    );

    for (const link of links ?? []) {
      const qty = receiptLineQty.get(link.receipt_line_id as string) || 0;
      receivedByPoLine.set(
        link.po_line_id as string,
        (receivedByPoLine.get(link.po_line_id as string) || 0) + qty
      );
    }
  }

  let allFullyReceived = true;
  let anyReceived = false;

  for (const poLine of poLines) {
    const received = receivedByPoLine.get(poLine.id as string) || 0;
    if (received > 0) anyReceived = true;
    if (received < Number(poLine.qty)) allFullyReceived = false;
  }

  const newStatus =
    allFullyReceived && anyReceived ? "Received" : anyReceived ? "Partially Received" : "Issued";

  await db
    .schema("orchard_calcs")
    .from("po_statuses")
    .upsert({ po_id: poId, status: newStatus }, { onConflict: "po_id" });

  return newStatus;
}
