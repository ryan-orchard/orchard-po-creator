import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  // Fetch everything in parallel
  const [allReceiptLines, allInvoices, allPOs] = await Promise.all([
    getRecords(TABLES.RECEIPT_LINES),
    getRecords(TABLES.INVOICES),
    getRecords(TABLES.PURCHASE_ORDERS),
  ]);

  // Receipt lines not yet linked to a PO or WO
  const unmatchedReceiptLines = allReceiptLines.filter((rl) => {
    const status = (rl.fields["Status"] as string | undefined) || "";
    if (status === "Excluded" || status === "Matched") return false;
    const poLinks = rl.fields["PO Line Items"] as string[] | undefined;
    const woLinks = rl.fields["Work Order Lines"] as string[] | undefined;
    const sourceMatch = rl.fields["Source Match"] as string | undefined;
    const hasLink = (poLinks && poLinks.length > 0) || (woLinks && woLinks.length > 0) || sourceMatch === "Linked";
    return !hasLink;
  }).length;

  // Invoices not yet matched to a receipt (open or pending receipt, not paid)
  const invoicesWithoutReceipt = allInvoices.filter((inv) => {
    const status = ((inv.fields["Status"] as string) || "").toLowerCase();
    const payment = (inv.fields["Payment Status"] as string) || "";
    return (
      (status === "open" || status === "") &&
      payment !== "Paid"
    );
  }).length;

  // Invoices approved and not yet paid
  const readyToPay = allInvoices.filter((inv) => {
    const status = ((inv.fields["Status"] as string) || "").toLowerCase();
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
