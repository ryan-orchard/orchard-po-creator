import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, updateRecord, TABLES } from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

/**
 * POST /api/match/[invoiceId]/receipts/confirm
 *
 * Confirms one or more receipt headers against this invoice.
 *
 * For each receipt:
 * 1. Gets all receipt lines for that receipt
 * 2. Gets all invoice lines for this invoice
 * 3. Auto-matches receipt lines → invoice lines by SKU
 * 4. Writes "Receipt Line" link on each matched Invoice Line
 * 5. Sets Receipt Line Match Status = "Matched"
 *
 * After all receipts confirmed, sets Invoice Match Status = "Approved".
 *
 * Body: { receiptIds: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const { receiptIds } = await request.json() as { receiptIds: string[] };

    if (!receiptIds?.length) {
      return NextResponse.json({ error: "receiptIds required" }, { status: 400 });
    }

    const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
    if (!invoiceRecord) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const invoiceNumber = (invoiceRecord.fields["Invoice Number"] as string) || invoiceId;

    // Fetch invoice lines (with SKU + existing Receipt Line)
    const invoiceLineIds = (invoiceRecord.fields["Invoice Lines"] as string[] | undefined) || [];
    const invoiceLines = await Promise.all(
      invoiceLineIds.map((lid) => getRecord(TABLES.INVOICE_LINES, lid))
    );

    // Build SKU → invoice line map (first match wins per SKU)
    const skuToInvoiceLine: Record<string, { id: string; skuId: string }> = {};
    for (const il of invoiceLines) {
      if (!il) continue;
      const skuIds = il.fields["SKU"] as string[] | undefined;
      const skuId = skuIds?.[0];
      if (skuId && !skuToInvoiceLine[skuId]) {
        skuToInvoiceLine[skuId] = { id: il.id, skuId };
      }
    }

    // Fetch all receipt lines for the selected receipts
    const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
    const relevantReceiptLines = allReceiptLines.filter((rl) => {
      const receiptLink = rl.fields["Receipt"] as string[] | undefined;
      return receiptLink?.[0] && receiptIds.includes(receiptLink[0]);
    });

    // Build SKU → invoice line unit cost map for write-backs
    const skuToUnitCost: Record<string, number> = {};
    for (const il of invoiceLines) {
      if (!il) continue;
      const skuIds = il.fields["SKU"] as string[] | undefined;
      const skuId = skuIds?.[0];
      if (skuId) {
        skuToUnitCost[skuId] = (il.fields["Unit Cost"] as number) || 0;
      }
    }

    // Match receipt lines to invoice lines by SKU and write the link + cost fields
    let linesMatched = 0;
    const updates: Promise<unknown>[] = [];

    for (const rl of relevantReceiptLines) {
      const rlSkuIds = rl.fields["SKU"] as string[] | undefined;
      const skuId = rlSkuIds?.[0];
      if (!skuId) continue;

      const invoiceLine = skuToInvoiceLine[skuId];
      if (invoiceLine) {
        // Write Receipt Line → Invoice Line link on the Invoice Line
        updates.push(
          updateRecord(TABLES.INVOICE_LINES, invoiceLine.id, {
            "Receipt Line": [rl.id],
          })
        );
        // Set Receipt Line status + write confirmed cost
        const unitCost = skuToUnitCost[skuId];
        const receiptLineUpdate: Record<string, unknown> = { "Status": "Matched" };
        if (unitCost && unitCost > 0) {
          receiptLineUpdate["Supplier Unit Cost"] = unitCost;
          receiptLineUpdate["Cost Source"] = "Invoiced";
        }
        updates.push(updateRecord(TABLES.RECEIPT_LINES, rl.id, receiptLineUpdate));
        linesMatched++;
      }
    }

    await Promise.all(updates);

    // Update Invoice Match Status = Matched
    await updateRecord(TABLES.INVOICES, invoiceId, {
      "Status": "Matched",
    });

    // Log activity
    const receiptNumbers: string[] = [];
    for (const rId of receiptIds) {
      const r = await getRecord(TABLES.RECEIPTS, rId);
      if (r) receiptNumbers.push((r.fields["Receipt Number"] as string) || rId);
    }

    const linkedPOIds = (invoiceRecord.fields["Purchase Order"] as string[] | undefined) || [];
    const linkedWOIds = (invoiceRecord.fields["Work Orders"] as string[] | undefined) || [];

    logActivity({
      poId: linkedPOIds[0],
      woId: linkedWOIds[0],
      action: "invoice_matched",
      description: `Invoice ${invoiceNumber} confirmed against ${receiptNumbers.join(", ")}`,
      actor: "Ryan Belanger",
      relatedRecordType: "invoice",
      relatedRecordId: invoiceId,
    });

    return NextResponse.json({
      success: true,
      invoiceId,
      receiptIds,
      linesMatched,
      matchStatus: "Approved",
    });
  } catch (error) {
    console.error("Receipt confirm error:", error);
    return NextResponse.json({ error: "Failed to confirm receipts" }, { status: 500 });
  }
}

/**
 * DELETE /api/match/[invoiceId]/receipts/confirm
 *
 * Removes a receipt confirmation: clears Receipt Line links on Invoice Lines
 * that came from the given receipts, resets Receipt Line Match Status.
 *
 * Body: { receiptId: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const { receiptId } = await request.json() as { receiptId: string };

    if (!receiptId) {
      return NextResponse.json({ error: "receiptId required" }, { status: 400 });
    }

    const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
    if (!invoiceRecord) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Get receipt lines for this receipt
    const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
    const receiptLines = allReceiptLines.filter((rl) => {
      const receiptLink = rl.fields["Receipt"] as string[] | undefined;
      return receiptLink?.[0] === receiptId;
    });
    const receiptLineIds = new Set(receiptLines.map((rl) => rl.id));

    // Get invoice lines and clear any that link to these receipt lines
    const invoiceLineIds = (invoiceRecord.fields["Invoice Lines"] as string[] | undefined) || [];
    const invoiceLines = await Promise.all(
      invoiceLineIds.map((lid) => getRecord(TABLES.INVOICE_LINES, lid))
    );

    const updates: Promise<unknown>[] = [];
    for (const il of invoiceLines) {
      if (!il) continue;
      const receiptLineLink = il.fields["Receipt Line"] as string[] | undefined;
      if (receiptLineLink?.[0] && receiptLineIds.has(receiptLineLink[0])) {
        updates.push(updateRecord(TABLES.INVOICE_LINES, il.id, { "Receipt Line": [] }));
      }
    }

    // Reset Receipt Line Match Status
    for (const rl of receiptLines) {
      updates.push(updateRecord(TABLES.RECEIPT_LINES, rl.id, { "Status": "Open" }));
    }

    await Promise.all(updates);

    // Reset invoice match status to Pending Receipt
    await updateRecord(TABLES.INVOICES, invoiceId, { "Status": "Open" });

    return NextResponse.json({ success: true, receiptId });
  } catch (error) {
    console.error("Receipt unconfirm error:", error);
    return NextResponse.json({ error: "Failed to remove receipt confirmation" }, { status: 500 });
  }
}
