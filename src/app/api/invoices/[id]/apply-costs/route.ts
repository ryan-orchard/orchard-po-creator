import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { getRecord, getRecords, updateRecord, TABLES } from "@/lib/airtable";

/**
 * POST /api/invoices/[id]/apply-costs
 *
 * Applies landed cost data from an invoice to its linked receipt lines.
 *
 * Supplier invoices:
 *   Invoice Lines → Receipt Lines (via "Receipt Lines" link field)
 *   Writes: Supplier Unit Cost = invoice line unit cost, Cost Source = "Invoiced"
 *
 * Freight / Customs invoices:
 *   Invoice → Shipment → Receipts → Receipt Lines
 *   Writes: Freight Allocation or Customs Allocation = total invoice amount / total units across all lines
 *   (per-unit allocation, same for all lines)
 */
export async function POST(
  _request: NextRequest,
  {
 params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  try {
    const { id } = await params;
    const invoice = await getRecord(TABLES.INVOICES, id);
    if (!invoice?.fields) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const f = invoice.fields;
    const invoiceType = (f["Type"] as string) || "Supplier";
    const totalAmount = (f["Total Amount"] as number) || 0;

    // ── Supplier invoice ──────────────────────────────────────────────────────
    if (invoiceType === "Supplier") {
      const lineIds = f["Invoice Lines"] as string[] | undefined;
      if (!lineIds?.length) {
        return NextResponse.json(
          { error: "No invoice lines found on this invoice." },
          { status: 400 }
        );
      }

      const lineRecords = await Promise.all(
        lineIds.map((lid) => getRecord(TABLES.INVOICE_LINES, lid))
      );

      const updates: Promise<unknown>[] = [];
      let updatedCount = 0;

      for (const lr of lineRecords) {
        // "Receipt Line" is the linked record field on Invoice Lines → Receipt Lines
        const receiptLineIds = lr.fields["Receipt Line"] as string[] | undefined;
        if (!receiptLineIds?.length) continue;

        const unitCost = (lr.fields["Unit Cost"] as number) || 0;
        for (const rlId of receiptLineIds) {
          updates.push(
            updateRecord(TABLES.RECEIPT_LINES, rlId, {
              "Supplier Unit Cost": unitCost,
              "Cost Source": "Invoiced",
            })
          );
          updatedCount++;
        }
      }

      if (updates.length === 0) {
        return NextResponse.json(
          { error: "No receipt lines are linked to this invoice's line items. Link invoice lines to receipt lines first." },
          { status: 400 }
        );
      }

      await Promise.all(updates);
      return NextResponse.json({
        success: true,
        updated: updatedCount,
        type: "supplier",
        message: `Updated Supplier Unit Cost on ${updatedCount} receipt line${updatedCount !== 1 ? "s" : ""}.`,
      });
    }

    // ── Freight / Customs invoice ─────────────────────────────────────────────
    if (invoiceType === "Freight" || invoiceType === "Customs") {
      const shipmentIds = f["Shipment"] as string[] | undefined;
      if (!shipmentIds?.length) {
        return NextResponse.json(
          { error: "No linked shipment on this invoice. Link a shipment first." },
          { status: 400 }
        );
      }

      const shipment = await getRecord(TABLES.SHIPMENTS, shipmentIds[0]);
      // "Receipts" is the linked record field on Shipments → Receipts
      const receiptIds = shipment.fields["Receipts"] as string[] | undefined;
      if (!receiptIds?.length) {
        return NextResponse.json(
          { error: "No receipts linked to this shipment." },
          { status: 400 }
        );
      }

      // Fetch all receipt lines for those receipts
      const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
      const relevantLines = allReceiptLines.filter((rl) => {
        const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
        return rlReceiptIds?.[0] && receiptIds.includes(rlReceiptIds[0]);
      });

      if (!relevantLines.length) {
        return NextResponse.json(
          { error: "No receipt lines found for this shipment's receipts." },
          { status: 400 }
        );
      }

      const totalQty = relevantLines.reduce(
        (sum, rl) => sum + ((rl.fields["Qty Received"] as number) || 0),
        0
      );
      if (totalQty === 0) {
        return NextResponse.json(
          { error: "All receipt lines have zero quantity — cannot allocate." },
          { status: 400 }
        );
      }

      const allocationField =
        invoiceType === "Freight" ? "Freight Allocation" : "Customs Allocation";
      const perUnitAllocation =
        Math.round((totalAmount / totalQty) * 10000) / 10000;

      await Promise.all(
        relevantLines.map((rl) =>
          updateRecord(TABLES.RECEIPT_LINES, rl.id, {
            [allocationField]: perUnitAllocation,
          })
        )
      );

      return NextResponse.json({
        success: true,
        updated: relevantLines.length,
        type: invoiceType.toLowerCase(),
        perUnitAllocation,
        totalQty,
        message: `Applied ${invoiceType.toLowerCase()} allocation of $${perUnitAllocation.toFixed(4)}/unit across ${relevantLines.length} receipt line${relevantLines.length !== 1 ? "s" : ""} (${totalQty.toLocaleString()} total units).`,
      });
    }

    return NextResponse.json(
      { error: `Cost application is not supported for invoice type: ${invoiceType}.` },
      { status: 400 }
    );
  } catch (error) {
    console.error("Apply costs error:", error);
    return NextResponse.json(
      { error: `Failed to apply costs: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
