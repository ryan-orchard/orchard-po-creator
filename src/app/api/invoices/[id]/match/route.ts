import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, updateRecord, TABLES } from "@/lib/airtable";

/**
 * PATCH /api/invoices/[id]/match
 *
 * Links an invoice to a PO at header level AND links individual invoice lines
 * to their corresponding PO line items. Sets invoice status based on variance.
 *
 * Body: {
 *   purchaseOrderId: string,
 *   lineMatches: { invoiceLineId: string, poLineItemId: string }[],
 *   hasDiscrepancy?: boolean
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const body = await request.json();
    const { purchaseOrderId, lineMatches, hasDiscrepancy } = body as {
      purchaseOrderId: string;
      lineMatches?: { invoiceLineId: string; poLineItemId: string }[];
      hasDiscrepancy?: boolean;
    };

    if (!purchaseOrderId) {
      return NextResponse.json(
        { error: "purchaseOrderId is required" },
        { status: 400 }
      );
    }

    // Verify the PO exists
    const po = await getRecord(TABLES.PURCHASE_ORDERS, purchaseOrderId);
    if (!po || po.id !== purchaseOrderId) {
      return NextResponse.json(
        { error: "Purchase Order not found" },
        { status: 404 }
      );
    }

    // 1. Link invoice lines to PO line items (line level)
    if (lineMatches && lineMatches.length > 0) {
      await Promise.all(
        lineMatches
          .filter((m) => m.invoiceLineId && m.poLineItemId)
          .map((m) =>
            updateRecord(TABLES.INVOICE_LINES, m.invoiceLineId, {
              "PO Line Item": [m.poLineItemId],
            })
          )
      );
    }

    // 2. Check if ALL invoice lines are now matched — only then set header PO link
    const allInvoiceLines = await getRecords(TABLES.INVOICE_LINES);
    const thisInvoiceLines = allInvoiceLines.filter((il) => {
      const invoiceIds = il.fields["Invoice"] as string[] | undefined;
      return invoiceIds?.[0] === invoiceId;
    });
    const allLinesMatched =
      thisInvoiceLines.length > 0 &&
      thisInvoiceLines.every((il) => {
        const poLineItemLink = il.fields["PO Line Item"] as
          | string[]
          | undefined;
        return poLineItemLink && poLineItemLink.length > 0;
      });

    // Set header Invoice → PO link when all lines are matched
    if (allLinesMatched) {
      await updateRecord(TABLES.INVOICES, invoiceId, {
        "Purchase Order": [purchaseOrderId],
      });
    }

    // 3. Set review status based on discrepancy flag
    const newStatus = hasDiscrepancy ? "Discrepancy" : "Matched";
    await updateRecord(TABLES.INVOICES, invoiceId, {
      "Review Status": newStatus,
    });

    return NextResponse.json({
      success: true,
      invoiceId,
      purchaseOrderId,
      poNumber: (po.fields["PO Number"] as string) || "",
      status: newStatus,
      linesMatched: lineMatches?.length || 0,
    });
  } catch (error) {
    console.error("Match error:", error);
    return NextResponse.json(
      {
        error: `Failed to match invoice: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
