import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  const allInvoices = await getRecords(TABLES.INVOICES);

  // Count invoices that need attention: Match Status = Open, or no Match Status and no PO link (legacy)
  const unmatched = allInvoices.filter((inv) => {
    const matchStatus = inv.fields["Match Status"] as string | undefined;
    if (matchStatus) return matchStatus === "Open";
    // Legacy: no Match Status field yet — fall back to checking PO link
    const poLink = inv.fields["Purchase Order"] as string[] | undefined;
    return !poLink?.[0];
  });

  return NextResponse.json({ unmatched: unmatched.length });
}
