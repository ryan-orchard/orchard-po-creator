import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { setReceiptLineStatus } from "@/lib/receipt-status";

/**
 * POST /api/receipt-lines/[id]/unmatch
 *
 * Clears the PO or WO link on a receipt line:
 * - PO match: delete from po_line_receipt_line_links, reset status to Open
 * - WO match: delete from wo_receipt_links (header-level), reset status to Open
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  try {
    const { id: receiptLineId } = await params;

    // Fetch the receipt line
    const { data: receiptLine } = await db
      .schema("orchard")
      .from("receipt_lines")
      .select("id, receipt_id, status")
      .eq("id", receiptLineId)
      .maybeSingle();

    if (!receiptLine) {
      return NextResponse.json({ error: "Receipt line not found" }, { status: 404 });
    }

    const receiptId = receiptLine.receipt_id as string;

    // Check for PO link (line-level)
    const { data: poLink } = await db
      .schema("orchard_calcs")
      .from("po_line_receipt_line_links")
      .select("id, po_line_id")
      .eq("receipt_line_id", receiptLineId)
      .maybeSingle();

    // Check for WO link (header-level — linked to the receipt)
    const { data: woLink } = await db
      .schema("orchard_calcs")
      .from("wo_receipt_links")
      .select("id, wo_id")
      .eq("receipt_id", receiptId)
      .maybeSingle();

    if (!poLink && !woLink) {
      return NextResponse.json({ error: "Receipt line is not matched" }, { status: 400 });
    }

    if (poLink) {
      // Delete the line-level link
      await db
        .schema("orchard_calcs")
        .from("po_line_receipt_line_links")
        .delete()
        .eq("receipt_line_id", receiptLineId);
    }

    if (woLink) {
      // Delete the header-level WO-receipt link
      await db
        .schema("orchard_calcs")
        .from("wo_receipt_links")
        .delete()
        .eq("receipt_id", receiptId);
    }

    // Reset receipt line status to Open (Silver)
    await setReceiptLineStatus(receiptLineId, "Open");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unmatch error:", error);
    return NextResponse.json(
      { error: `Failed to unmatch: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
