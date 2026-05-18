import { db } from "./supabase";

export type ReceiptLineStatus =
  | "Open"
  | "Unmatched"
  | "Matched"
  | "Excluded"
  | "Review";

/**
 * Write match status for a receipt line to Silver
 * (orchard_calcs.receipt_line_statuses). Idempotent upsert.
 */
export async function setReceiptLineStatus(
  receiptLineId: string,
  status: ReceiptLineStatus,
  updatedBy?: string,
) {
  return db
    .schema("orchard_calcs")
    .from("receipt_line_statuses")
    .upsert(
      {
        receipt_line_id: receiptLineId,
        status,
        updated_at: new Date().toISOString(),
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      },
      { onConflict: "receipt_line_id" },
    );
}

export async function setReceiptLineStatuses(
  receiptLineIds: string[],
  status: ReceiptLineStatus,
  updatedBy?: string,
) {
  if (receiptLineIds.length === 0) return { error: null, data: null };
  return db
    .schema("orchard_calcs")
    .from("receipt_line_statuses")
    .upsert(
      receiptLineIds.map((id) => ({
        receipt_line_id: id,
        status,
        updated_at: new Date().toISOString(),
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      })),
      { onConflict: "receipt_line_id" },
    );
}
