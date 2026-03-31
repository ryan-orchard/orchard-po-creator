import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, TABLES } from "@/lib/airtable";

/**
 * POST /api/invoices/[id]/unmatch
 *
 * Clears the invoice match at line level:
 * - Removes Receipt Line + PO Line Item links on all invoice lines
 * - Clears Purchase Order header link
 * - Resets Match Status to Open
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;

    // 1. Clear Receipt Line + PO Line Item links on all invoice lines
    const allInvoiceLines = await getRecords(TABLES.INVOICE_LINES);
    const thisInvoiceLines = allInvoiceLines.filter((il) => {
      const invoiceIds = il.fields["Invoice"] as string[] | undefined;
      return invoiceIds?.[0] === invoiceId;
    });

    const linkedLines = thisInvoiceLines.filter((il) => {
      const poLink = il.fields["PO Line Item"] as string[] | undefined;
      const receiptLink = il.fields["Receipt Line"] as string[] | undefined;
      return (poLink && poLink.length > 0) || (receiptLink && receiptLink.length > 0);
    });

    if (linkedLines.length > 0) {
      await Promise.all(
        linkedLines.map((il) =>
          updateRecord(TABLES.INVOICE_LINES, il.id, {
            "PO Line Item": [],
            "Receipt Line": [],
          })
        )
      );
    }

    // 2. Clear header PO link and reset status
    await updateRecord(TABLES.INVOICES, invoiceId, {
      "Purchase Order": [],
      "Status": "Open",
    });

    return NextResponse.json({
      success: true,
      invoiceId,
      linesCleared: linkedLines.length,
    });
  } catch (error) {
    console.error("Invoice unmatch error:", error);
    return NextResponse.json(
      {
        error: `Failed to unmatch invoice: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
