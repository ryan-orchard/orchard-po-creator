import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  // Fetch everything in parallel
  const [allReceiptLines, allInvoices, allPOs] = await Promise.all([
    getRecords(TABLES.RECEIPT_LINES),
    getRecords(TABLES.INVOICES),
    getRecords(TABLES.PURCHASE_ORDERS),
  ]);

  // Receipt lines not yet matched to a PO
  const unmatchedReceiptLines = allReceiptLines.filter((rl) => {
    const status = rl.fields["Match Status"] as string | undefined;
    return !status || status === "Open";
  }).length;

  // Invoices not yet matched to a receipt (open or pending receipt, not paid)
  const invoicesWithoutReceipt = allInvoices.filter((inv) => {
    const status = ((inv.fields["Match Status"] as string) || "").toLowerCase();
    const payment = (inv.fields["Payment Status"] as string) || "";
    return (
      (status === "open" || status === "pending receipt" || status === "") &&
      payment !== "Paid"
    );
  }).length;

  // Invoices approved and not yet paid
  const readyToPay = allInvoices.filter((inv) => {
    const status = ((inv.fields["Match Status"] as string) || "").toLowerCase();
    const payment = (inv.fields["Payment Status"] as string) || "";
    return status === "approved" && payment !== "Paid";
  }).length;

  // POs with an active status
  const posInProgress = allPOs.filter((po) => {
    const status = (po.fields["Status"] as string) || "";
    return status === "Draft" || status === "Issued" || status === "Accepted";
  }).length;

  return NextResponse.json({
    unmatchedReceiptLines,
    invoicesWithoutReceipt,
    readyToPay,
    posInProgress,
  });
}
