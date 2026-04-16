import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";

/**
 * PATCH /api/invoices/[id]/match
 *
 * Multiple match flows:
 * - { approve: true } — explicit human sign-off, set status to Matched
 * - { pendingReceipt: true, poId } — link to PO, status stays Open (receipt pending)
 * - { shipmentId } — link to Shipment, set status to Matched
 * - { workOrderId } — link to WO, set status to Matched
 * - { receiptId, lineMatches, hasDiscrepancy } — full line-level match
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  try {
    const { id: invoiceId } = await params;
    const body = await request.json();

    // Fetch invoice for logging
    const { data: invoice } = await db
      .schema("orchard")
      .from("invoices")
      .select("id, invoice_number")
      .eq("id", invoiceId)
      .maybeSingle();
    const invoiceNumber = (invoice?.invoice_number as string) || invoiceId;

    // Approve — explicit sign-off on any invoice (including discrepancies)
    if (body.approve) {
      await setInvoiceMatchStatus(invoiceId, "Matched");
      logActivity({
        action: "invoice_approved",
        description: `Invoice ${invoiceNumber} approved for payment`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });
      return NextResponse.json({ success: true, invoiceId, matchStatus: "Matched" });
    }

    // Pending receipt — link to PO now, receipt hasn't arrived yet
    if (body.pendingReceipt && body.poId) {
      const { data: po } = await db
        .schema("orchard")
        .from("purchase_orders")
        .select("id, po_number")
        .eq("id", body.poId as string)
        .maybeSingle();
      if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });

      await db.schema("orchard").from("invoices").update({ po_id: body.poId, match_status: "Open" }).eq("id", invoiceId);
      await db.schema("orchard_calcs").from("invoice_statuses").upsert(
        { invoice_id: invoiceId, match_status: "Open", updated_by: "Ryan Belanger" },
        { onConflict: "invoice_id" }
      );

      logActivity({
        poId: body.poId,
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} linked to ${po.po_number} — awaiting receipt`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });
      return NextResponse.json({
        success: true,
        invoiceId,
        poId: body.poId,
        poNumber: po.po_number,
        matchStatus: "Open",
      });
    }

    // Shipment match
    if (body.shipmentId) {
      const { data: shipment } = await db
        .schema("orchard")
        .from("shipments")
        .select("id, shipment_number")
        .eq("id", body.shipmentId as string)
        .maybeSingle();
      if (!shipment) return NextResponse.json({ error: "Shipment not found" }, { status: 404 });

      await db
        .schema("orchard")
        .from("invoices")
        .update({ shipment_id: body.shipmentId, match_status: "Matched" })
        .eq("id", invoiceId);
      await setInvoiceMatchStatus(invoiceId, "Matched");

      logActivity({
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} matched to ${shipment.shipment_number}`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });
      return NextResponse.json({
        success: true,
        invoiceId,
        shipmentId: body.shipmentId,
        shipmentNumber: shipment.shipment_number,
        matchStatus: "Matched",
      });
    }

    // WO match
    if (body.workOrderId) {
      const { data: wo } = await db
        .schema("orchard")
        .from("work_orders")
        .select("id, wo_number")
        .eq("id", body.workOrderId as string)
        .maybeSingle();
      if (!wo) return NextResponse.json({ error: "Work Order not found" }, { status: 404 });

      await db
        .schema("orchard")
        .from("invoices")
        .update({ wo_id: body.workOrderId, match_status: "Matched" })
        .eq("id", invoiceId);
      await setInvoiceMatchStatus(invoiceId, "Matched");

      logActivity({
        woId: body.workOrderId,
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} matched to ${wo.wo_number}`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });
      return NextResponse.json({
        success: true,
        invoiceId,
        workOrderId: body.workOrderId,
        woNumber: wo.wo_number,
        matchStatus: "Matched",
      });
    }

    // Full line-level match (receipt + PO)
    const { receiptId, lineMatches, hasDiscrepancy } = body as {
      receiptId: string;
      lineMatches?: { invoiceLineId: string; receiptLineId: string; poLineItemId: string }[];
      hasDiscrepancy?: boolean;
    };

    if (!receiptId) {
      return NextResponse.json({ error: "receiptId is required" }, { status: 400 });
    }

    // Verify receipt and get its PO
    const { data: receipt } = await db
      .schema("orchard")
      .from("receipts")
      .select("id, receipt_number, po_id")
      .eq("id", receiptId)
      .maybeSingle();

    if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

    const receiptPoId = receipt.po_id as string | null;
    if (!receiptPoId) {
      return NextResponse.json({ error: "Receipt is not matched to a PO" }, { status: 400 });
    }

    const { data: po } = await db
      .schema("orchard")
      .from("purchase_orders")
      .select("id, po_number")
      .eq("id", receiptPoId)
      .maybeSingle();
    const poNumber = (po?.po_number as string) || "";

    // Insert line-level links
    if (lineMatches && lineMatches.length > 0) {
      const validMatches = lineMatches.filter((m) => m.invoiceLineId);

      // po_line_invoice_line_links
      const poLinks = validMatches.filter((m) => m.poLineItemId);
      if (poLinks.length > 0) {
        await db.schema("orchard_calcs").from("po_line_invoice_line_links").upsert(
          poLinks.map((m) => ({ po_line_id: m.poLineItemId, invoice_line_id: m.invoiceLineId })),
          { onConflict: "po_line_id,invoice_line_id" }
        );
      }

      // receipt_line_invoice_line_links
      const receiptLinks = validMatches.filter((m) => m.receiptLineId);
      if (receiptLinks.length > 0) {
        await db.schema("orchard_calcs").from("receipt_line_invoice_line_links").upsert(
          receiptLinks.map((m) => ({ receipt_line_id: m.receiptLineId, invoice_line_id: m.invoiceLineId })),
          { onConflict: "receipt_line_id,invoice_line_id" }
        );
      }
    }

    // Set invoice po_id and match status
    const matchStatus = hasDiscrepancy ? "Discrepancy" : "Matched";
    await db
      .schema("orchard")
      .from("invoices")
      .update({ po_id: receiptPoId, match_status: matchStatus })
      .eq("id", invoiceId);
    await setInvoiceMatchStatus(invoiceId, matchStatus);

    logActivity({
      poId: receiptPoId,
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
      receiptNumber: receipt.receipt_number,
      purchaseOrderId: receiptPoId,
      poNumber,
      matchStatus,
      linesMatched: lineMatches?.length || 0,
    });
  } catch (error) {
    console.error("Invoice match error:", error);
    return NextResponse.json(
      { error: `Failed to match invoice: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

async function setInvoiceMatchStatus(invoiceId: string, matchStatus: string) {
  await db
    .schema("orchard_calcs")
    .from("invoice_statuses")
    .upsert({ invoice_id: invoiceId, match_status: matchStatus, updated_by: "Ryan Belanger" }, { onConflict: "invoice_id" });
}
