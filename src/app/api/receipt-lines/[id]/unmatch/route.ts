import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { setReceiptLineTransferStatus } from "@/lib/receipt-status";

/**
 * POST /api/receipt-lines/[id]/unmatch
 *
 * Removes a transfer-line match for this receipt line:
 * - Deletes from transfer_line_receipt_line_links
 * - Resets transfer_status to unmatched
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  try {
    const { id: receiptLineId } = await params;

    const { data: link } = await db
      .schema("orchard_calcs")
      .from("transfer_line_receipt_line_links")
      .select("id")
      .eq("receipt_line_id", receiptLineId)
      .maybeSingle();

    if (!link) {
      return NextResponse.json({ error: "Receipt line is not transfer-matched" }, { status: 400 });
    }

    await db
      .schema("orchard_calcs")
      .from("transfer_line_receipt_line_links")
      .delete()
      .eq("receipt_line_id", receiptLineId);

    await setReceiptLineTransferStatus(receiptLineId, "unmatched");

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to unmatch: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
