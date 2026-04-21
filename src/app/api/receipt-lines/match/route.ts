import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

/**
 * POST /api/receipt-lines/match
 *
 * Links receipt lines to an invoice line and marks them as Matched.
 * Body: { receiptLineIds: string[], invoiceLineId: string }
 */
export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const { receiptLineIds, invoiceLineId } = await request.json();

    if (!Array.isArray(receiptLineIds) || receiptLineIds.length === 0) {
      return NextResponse.json(
        { error: "receiptLineIds must be a non-empty array" },
        { status: 400 }
      );
    }
    if (!invoiceLineId) {
      return NextResponse.json(
        { error: "invoiceLineId is required" },
        { status: 400 }
      );
    }

    // Insert junction rows
    const rows = receiptLineIds.map((rlId: string) => ({
      invoice_line_id: invoiceLineId,
      receipt_line_id: rlId,
    }));

    const { error: insertError } = await db
      .schema("orchard_calcs")
      .from("invoice_line_receipt_lines")
      .insert(rows);

    if (insertError) throw insertError;

    // Update receipt line statuses to Matched
    const { error: updateError } = await db
      .schema("orchard")
      .from("receipt_lines")
      .update({ status: "Matched" })
      .in("id", receiptLineIds);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, matched: receiptLineIds.length });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to match: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
