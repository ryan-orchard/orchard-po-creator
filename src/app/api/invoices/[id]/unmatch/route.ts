import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

/**
 * POST /api/invoices/[id]/unmatch
 *
 * Clears the invoice match:
 * - Deletes po_line_invoice_line_links for all invoice lines
 * - Deletes receipt_line_invoice_line_links for all invoice lines
 * - Resets invoice.match_status to Open
 * - Syncs invoice_statuses.match_status
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  try {
    const { id: invoiceId } = await params;

    // Get all invoice lines for this invoice
    const { data: invoiceLines } = await db
      .schema("orchard")
      .from("invoice_lines")
      .select("id")
      .eq("invoice_id", invoiceId);

    const invoiceLineIds = (invoiceLines ?? []).map((il) => il.id as string);

    let linesCleared = 0;
    if (invoiceLineIds.length > 0) {
      // Delete po_line_invoice_line_links
      const { data: poLinks } = await db
        .schema("orchard_calcs")
        .from("po_line_invoice_line_links")
        .delete()
        .in("invoice_line_id", invoiceLineIds)
        .select("id");
      linesCleared += (poLinks ?? []).length;

      // Delete receipt_line_invoice_line_links
      const { data: receiptLinks } = await db
        .schema("orchard_calcs")
        .from("receipt_line_invoice_line_links")
        .delete()
        .in("invoice_line_id", invoiceLineIds)
        .select("id");
      linesCleared += (receiptLinks ?? []).length;
    }

    await db
      .schema("orchard_calcs")
      .from("invoice_statuses")
      .upsert({ invoice_id: invoiceId, match_status: "unmatched", updated_by: "Ryan Belanger" }, { onConflict: "invoice_id" });

    return NextResponse.json({ success: true, invoiceId, linesCleared });
  } catch (error) {
    console.error("Invoice unmatch error:", error);
    return NextResponse.json(
      { error: `Failed to unmatch invoice: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
