import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { rollUpPoStatus } from "@/lib/po-status";

export async function GET() {
  const today = new Date().toISOString().split("T")[0];

  const [
    unmatchedReceiptLinesResult,
    openInvoicesResult,
    poLinesResult,
    poLineStatusesResult,
    allInvoicesResult,
    invoiceStatusesResult,
  ] = await Promise.all([
    // Receipt lines not yet linked (Silver status = Open)
    db.schema("orchard_calcs").from("receipt_line_statuses").select("receipt_line_id", { count: "exact", head: true }).eq("transfer_status", "unmatched").is("flag", null),
    // Invoices that are Open or unmatched — read from authoritative invoice_statuses
    db.schema("orchard_calcs").from("invoice_statuses").select("invoice_id, match_status").neq("match_status", "matched"),
    // PO lines + their statuses — POs in progress roll up from these
    db.schema("orchard").from("po_lines").select("id, po_id"),
    db.schema("orchard_calcs").from("po_line_statuses").select("po_line_id, status"),
    // All invoices for AP summary
    db.schema("orchard").from("invoices").select("id, total_amount, due_date, payment_terms, invoice_date"),
    // Payment statuses
    db.schema("orchard_calcs").from("invoice_statuses").select("invoice_id, payment_status"),
  ]);

  // POs in progress = rolled-up status of ordered or confirmed (not complete).
  const lineStateById = new Map((poLineStatusesResult.data ?? []).map((s) => [s.po_line_id, s.status]));
  const lineStatesByPo = new Map<string, string[]>();
  for (const l of poLinesResult.data ?? []) {
    const arr = lineStatesByPo.get(l.po_id as string) ?? [];
    arr.push((lineStateById.get(l.id as string) as string) ?? "ordered");
    lineStatesByPo.set(l.po_id as string, arr);
  }
  let posInProgress = 0;
  for (const states of lineStatesByPo.values()) {
    const rolled = rollUpPoStatus(states);
    if (rolled === "ordered" || rolled === "confirmed") posInProgress++;
  }

  const openInvoices = openInvoicesResult.data ?? [];
  const invoicesWithoutReceipt = openInvoices.filter((inv) => inv.match_status === "unmatched" || !inv.match_status).length;

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
    posInProgress,
    ap: {
      totalUnpaid,
      unpaidCount,
      totalPastDue,
      pastDueCount,
    },
  });
}
