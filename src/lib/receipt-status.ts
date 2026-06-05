import { db } from "./supabase";

export type ReceiptLineTransferStatus = "unmatched" | "partial" | "matched";
export type ReceiptLineInvoiceStatus = "unmatched" | "matched";
export type ReceiptLineFlag = "excluded" | "review" | null;

function now() {
  return new Date().toISOString();
}

export async function setReceiptLineTransferStatus(
  receiptLineId: string,
  transferStatus: ReceiptLineTransferStatus,
  updatedBy?: string,
) {
  return db
    .schema("orchard_calcs")
    .from("receipt_line_statuses")
    .upsert(
      { receipt_line_id: receiptLineId, transfer_status: transferStatus, updated_at: now(), ...(updatedBy ? { updated_by: updatedBy } : {}) },
      { onConflict: "receipt_line_id" },
    );
}

export async function setReceiptLineTransferStatuses(
  receiptLineIds: string[],
  transferStatus: ReceiptLineTransferStatus,
  updatedBy?: string,
) {
  if (receiptLineIds.length === 0) return { error: null, data: null };
  return db
    .schema("orchard_calcs")
    .from("receipt_line_statuses")
    .upsert(
      receiptLineIds.map((id) => ({
        receipt_line_id: id,
        transfer_status: transferStatus,
        updated_at: now(),
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      })),
      { onConflict: "receipt_line_id" },
    );
}

export async function setReceiptLineInvoiceStatus(
  receiptLineId: string,
  invoiceStatus: ReceiptLineInvoiceStatus,
  updatedBy?: string,
) {
  return db
    .schema("orchard_calcs")
    .from("receipt_line_statuses")
    .upsert(
      { receipt_line_id: receiptLineId, invoice_status: invoiceStatus, updated_at: now(), ...(updatedBy ? { updated_by: updatedBy } : {}) },
      { onConflict: "receipt_line_id" },
    );
}

export async function setReceiptLineInvoiceStatuses(
  receiptLineIds: string[],
  invoiceStatus: ReceiptLineInvoiceStatus,
  updatedBy?: string,
) {
  if (receiptLineIds.length === 0) return { error: null, data: null };
  return db
    .schema("orchard_calcs")
    .from("receipt_line_statuses")
    .upsert(
      receiptLineIds.map((id) => ({
        receipt_line_id: id,
        invoice_status: invoiceStatus,
        updated_at: now(),
        ...(updatedBy ? { updated_by: updatedBy } : {}),
      })),
      { onConflict: "receipt_line_id" },
    );
}

export async function setReceiptLineFlag(
  receiptLineId: string,
  flag: ReceiptLineFlag,
  updatedBy?: string,
) {
  return db
    .schema("orchard_calcs")
    .from("receipt_line_statuses")
    .upsert(
      { receipt_line_id: receiptLineId, flag, updated_at: now(), ...(updatedBy ? { updated_by: updatedBy } : {}) },
      { onConflict: "receipt_line_id" },
    );
}

export function rollUpReceiptStatus(transferStatuses: string[]): string {
  if (transferStatuses.length === 0) return "open";
  const active = transferStatuses.filter((s) => s !== null);
  if (active.every((s) => s === "matched")) return "matched";
  if (active.some((s) => s === "matched" || s === "partial")) return "partial";
  return "open";
}
