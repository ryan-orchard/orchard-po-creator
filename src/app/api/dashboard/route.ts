import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const today = new Date().toISOString().split("T")[0];

  const [
    unmatchedReceiptLinesResult,
    openInvoicesResult,
    posInProgressResult,
    allInvoicesResult,
    invoiceStatusesResult,
  ] = await Promise.all([
    // Receipt lines not yet linked (Silver status = Open)
    db.schema("orchard_calcs").from("receipt_line_statuses").select("receipt_line_id", { count: "exact", head: true }).eq("status", "Open"),
    // Invoices that are Open and not Paid
    db.schema("orchard").from("invoices").select("id, match_status").neq("match_status", "Matched"),
    // POs actively in progress
    db.schema("orchard_calcs").from("po_statuses").select("status").in("status", ["Draft", "Issued", "Accepted"]),
    // All invoices for AP summary
    db.schema("orchard").from("invoices").select("id, total_amount, due_date, payment_terms, invoice_date"),
    // Payment statuses
    db.schema("orchard_calcs").from("invoice_statuses").select("invoice_id, payment_status"),
  ]);

  const openInvoices = openInvoicesResult.data ?? [];
  const invoicesWithoutReceipt = openInvoices.filter((inv) => inv.match_status === "Open").length;

  // Compute AP summary
  const payStatusMap = new Map((invoiceStatusesResult.data ?? []).map((s) => [s.invoice_id, s.payment_status as string]));
  const allInvoices = allInvoicesResult.data ?? [];

  let totalUnpaid = 0;
  let unpaidCount = 0;
  let totalPastDue = 0;
  let pastDueCount = 0;

  for (const inv of allInvoices) {
    const payStatus = payStatusMap.get(inv.id) ?? "Unpaid";
    if (payStatus === "Paid") continue;

    const amount = Number(inv.total_amount) || 0;
    totalUnpaid += amount;
    unpaidCount++;

    // Compute due date
    let dueDate = inv.due_date as string | null;
    if (!dueDate && inv.payment_terms && inv.invoice_date) {
      const netMatch = (inv.payment_terms as string).match(/^Net\s+(\d+)$/i);
      if (netMatch) {
        const d = new Date((inv.invoice_date as string) + "T00:00:00");
        d.setDate(d.getDate() + parseInt(netMatch[1], 10));
        dueDate = d.toISOString().split("T")[0];
      }
    }

    if (dueDate && dueDate <= today) {
      totalPastDue += amount;
      pastDueCount++;
    }
  }

  return NextResponse.json({
    unmatchedReceiptLines: unmatchedReceiptLinesResult.count ?? 0,
    invoicesWithoutReceipt,
    readyToPay: 0,
    posInProgress: posInProgressResult.data?.length ?? 0,
    ap: {
      totalUnpaid,
      unpaidCount,
      totalPastDue,
      pastDueCount,
    },
  });
}
