import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, updateRecord, TABLES } from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

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

    // Approve a discrepancy (or any invoice) — explicit human sign-off
    if (body.approve) {
      const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
      const invoiceNumber = (invoiceRecord?.fields["Invoice Number"] as string) || invoiceId;
      await updateRecord(TABLES.INVOICES, invoiceId, { "Status": "Matched" });
      logActivity({
        action: "invoice_approved",
        description: `Invoice ${invoiceNumber} approved for payment`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });
      return NextResponse.json({ success: true, invoiceId, matchStatus: "Matched" });
    }

    // PO-only match — confirm pricing before receipt arrives
    if (body.pendingReceipt && body.poId) {
      const po = await getRecord(TABLES.PURCHASE_ORDERS, body.poId);
      if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });
      await updateRecord(TABLES.INVOICES, invoiceId, {
        "Purchase Order": [body.poId],
        "Status": "Open",
      });
      const poNumber = (po.fields["PO Number"] as string) || body.poId;
      const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
      const invoiceNumber = (invoiceRecord?.fields["Invoice Number"] as string) || invoiceId;
      logActivity({
        poId: body.poId,
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} linked to ${poNumber} — awaiting receipt`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });
      return NextResponse.json({ success: true, invoiceId, poId: body.poId, poNumber, matchStatus: "Open" });
    }

    // Shipment match: link the invoice to the Shipment
    if (body.shipmentId) {
      const shipment = await getRecord(TABLES.SHIPMENTS, body.shipmentId);
      if (!shipment) {
        return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
      }
      await updateRecord(TABLES.INVOICES, invoiceId, {
        "Shipment": [body.shipmentId],
        "Status": "Matched",
      });
      const shipmentNumber = (shipment.fields["Shipment Number"] as string) || body.shipmentId;
      const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
      const invoiceNumber = (invoiceRecord?.fields["Invoice Number"] as string) || invoiceId;
      logActivity({
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} matched to ${shipmentNumber}`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });
      return NextResponse.json({ success: true, invoiceId, shipmentId: body.shipmentId, shipmentNumber, matchStatus: "Matched" });
    }

    // WO match: simpler path — just link the invoice to the WO
    if (body.workOrderId) {
      const wo = await getRecord(TABLES.WORK_ORDERS, body.workOrderId);
      if (!wo) {
        return NextResponse.json({ error: "Work Order not found" }, { status: 404 });
      }
      await updateRecord(TABLES.INVOICES, invoiceId, {
        "Work Orders": [body.workOrderId],
        "Status": "Matched",
      });
      const woNumber = (wo.fields["WO Number"] as string) || body.workOrderId;
      const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
      const invoiceNumber = (invoiceRecord?.fields["Invoice Number"] as string) || invoiceId;
      logActivity({
        woId: body.workOrderId,
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} matched to ${woNumber}`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });
      return NextResponse.json({ success: true, invoiceId, workOrderId: body.workOrderId, woNumber, matchStatus: "Matched" });
    }

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
      "Status": matchStatus,
    });

    // Get invoice number for the log
    const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
    const invoiceNumber = (invoiceRecord?.fields["Invoice Number"] as string) || invoiceId;
    logActivity({
      poId: receiptPOLink,
      action: "invoice_matched",
      description: `Invoice ${invoiceNumber} ${matchStatus === "Discrepancy" ? "matched with discrepancy" : "matched"}`,
      actor: "Ryan Belanger",
      relatedRecordType: "invoice",
      relatedRecordId: invoiceId,
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
