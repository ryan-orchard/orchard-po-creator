import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const [
    unmatchedReceiptLinesResult,
    openInvoicesResult,
    posInProgressResult,
  ] = await Promise.all([
    // Receipt lines not yet linked (status = Open)
    db.schema("orchard").from("receipt_lines").select("id", { count: "exact", head: true }).eq("status", "Open"),
    // Invoices that are Open and not Paid
    db.schema("orchard").from("invoices").select("id, match_status").neq("match_status", "Matched"),
    // POs actively in progress
    db.schema("orchard_calcs").from("po_statuses").select("status").in("status", ["Draft", "Issued", "Accepted"]),
  ]);

  // Invoices without receipt = open and not paid
  // We don't have a direct "readyToPay" concept yet — return 0 for now
  const openInvoices = openInvoicesResult.data ?? [];
  const invoicesWithoutReceipt = openInvoices.filter((inv) => inv.match_status === "Open").length;

  return NextResponse.json({
    unmatchedReceiptLines: unmatchedReceiptLinesResult.count ?? 0,
    invoicesWithoutReceipt,
    readyToPay: 0,
    posInProgress: posInProgressResult.data?.length ?? 0,
  });
}
