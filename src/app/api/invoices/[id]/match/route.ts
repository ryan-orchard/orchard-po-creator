import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, updateRecord, TABLES } from "@/lib/airtable";

/**
 * PATCH /api/invoices/[id]/match
 *
 * Match an invoice at the line level:
 * - Links each Invoice Line → Receipt Line
 * - Links each Invoice Line → PO Line Item
 * - Sets Invoice → Purchase Order (header, for reference)
 * - Sets Match Status to Matched or Discrepancy
 *
 * Body: {
 *   receiptId: string,  // which receipt (to derive PO)
 *   lineMatches: {
 *     invoiceLineId: string,
 *     receiptLineId: string,
 *     poLineItemId: string
 *   }[],
 *   hasDiscrepancy: boolean
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const body = await request.json();
    const { receiptId, lineMatches, hasDiscrepancy } = body as {
      receiptId: string;
      lineMatches?: {
        invoiceLineId: string;
        receiptLineId: string;
        poLineItemId: string;
      }[];
      hasDiscrepancy?: boolean;
    };

    if (!receiptId) {
      return NextResponse.json(
        { error: "receiptId is required" },
        { status: 400 }
      );
    }

    // Verify the receipt exists and get its PO link
    const receipt = await getRecord(TABLES.RECEIPTS, receiptId);
    if (!receipt) {
      return NextResponse.json(
        { error: "Receipt not found" },
        { status: 404 }
      );
    }

    const receiptPOLink = (receipt.fields["Purchase Order"] as string[] | undefined)?.[0];
    if (!receiptPOLink) {
      return NextResponse.json(
        { error: "Receipt is not matched to a PO" },
        { status: 400 }
      );
    }

    // Get PO number for the response
    const po = await getRecord(TABLES.PURCHASE_ORDERS, receiptPOLink);
    const poNumber = (po?.fields["PO Number"] as string) || "";
    const receiptNumber = (receipt.fields["Receipt Number"] as string) || "";

    // 1. Link invoice lines to receipt lines and PO line items
    if (lineMatches && lineMatches.length > 0) {
      await Promise.all(
        lineMatches
          .filter((m) => m.invoiceLineId)
          .map((m) => {
            const fields: Record<string, unknown> = {};
            if (m.receiptLineId) fields["Receipt Line"] = [m.receiptLineId];
            if (m.poLineItemId) fields["PO Line Item"] = [m.poLineItemId];
            return updateRecord(TABLES.INVOICE_LINES, m.invoiceLineId, fields);
          })
      );
    }

    // 2. Set header PO link and match status
    const matchStatus = hasDiscrepancy ? "Discrepancy" : "Matched";
    await updateRecord(TABLES.INVOICES, invoiceId, {
      "Purchase Order": [receiptPOLink],
      "Match Status": matchStatus,
    });

    return NextResponse.json({
      success: true,
      invoiceId,
      receiptId,
      receiptNumber,
      purchaseOrderId: receiptPOLink,
      poNumber,
      matchStatus,
      linesMatched: lineMatches?.length || 0,
    });
  } catch (error) {
    console.error("Invoice match error:", error);
    return NextResponse.json(
      {
        error: `Failed to match invoice: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
