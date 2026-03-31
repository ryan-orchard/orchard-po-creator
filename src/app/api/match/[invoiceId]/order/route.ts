import { NextRequest, NextResponse } from "next/server";
import { getRecord, updateRecord, TABLES } from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

/**
 * POST /api/match/[invoiceId]/order
 *
 * Links an invoice to a PO, WO, or marks it as "No Order" (credit card case).
 *
 * Body:
 *   { type: "po", id: string }
 *   { type: "wo", id: string }
 *   { type: "none" }         ← no order / credit card
 *   { type: "unlink" }       ← remove existing order link
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const body = await request.json() as { type: "po" | "wo" | "none" | "unlink"; id?: string };

    const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
    if (!invoiceRecord) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    const invoiceNumber = (invoiceRecord.fields["Invoice Number"] as string) || invoiceId;
    const currentPOIds = (invoiceRecord.fields["Purchase Order"] as string[] | undefined) || [];
    const currentWOIds = (invoiceRecord.fields["Work Orders"] as string[] | undefined) || [];

    if (body.type === "po") {
      if (!body.id) return NextResponse.json({ error: "id required for PO link" }, { status: 400 });
      const po = await getRecord(TABLES.PURCHASE_ORDERS, body.id);
      if (!po) return NextResponse.json({ error: "PO not found" }, { status: 404 });
      const poNumber = (po.fields["PO Number"] as string) || body.id;

      const updates: Record<string, unknown> = {
        "Purchase Order": [body.id],
        "Status": "Open",
      };
      // Only clear WO if one is currently linked
      if (currentWOIds.length > 0) updates["Work Orders"] = [];

      await updateRecord(TABLES.INVOICES, invoiceId, updates);

      logActivity({
        poId: body.id,
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} linked to ${poNumber}`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });

      return NextResponse.json({ success: true, type: "po", poNumber, matchStatus: "Open" });
    }

    if (body.type === "wo") {
      if (!body.id) return NextResponse.json({ error: "id required for WO link" }, { status: 400 });
      const wo = await getRecord(TABLES.WORK_ORDERS, body.id);
      if (!wo) return NextResponse.json({ error: "Work Order not found" }, { status: 404 });
      const woNumber = (wo.fields["WO Number"] as string) || body.id;

      const updates: Record<string, unknown> = {
        "Work Orders": [body.id],
        "Status": "Matched",
      };
      // Only clear PO if one is currently linked
      if (currentPOIds.length > 0) updates["Purchase Order"] = [];

      await updateRecord(TABLES.INVOICES, invoiceId, updates);

      logActivity({
        woId: body.id,
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} linked to ${woNumber}`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });

      return NextResponse.json({ success: true, type: "wo", woNumber, matchStatus: "Approved" });
    }

    if (body.type === "none") {
      // Set to Matched (no receipt/PO needed for credit card purchases)
      const updates: Record<string, unknown> = { "Status": "Matched" };
      if (currentPOIds.length > 0) updates["Purchase Order"] = [];
      if (currentWOIds.length > 0) updates["Work Orders"] = [];

      await updateRecord(TABLES.INVOICES, invoiceId, updates);

      logActivity({
        action: "invoice_matched",
        description: `Invoice ${invoiceNumber} marked as no order (credit card / direct purchase)`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });

      return NextResponse.json({ success: true, type: "none", matchStatus: "Approved" });
    }

    if (body.type === "unlink") {
      const updates: Record<string, unknown> = { "Status": "Open" };
      if (currentPOIds.length > 0) updates["Purchase Order"] = [];
      if (currentWOIds.length > 0) updates["Work Orders"] = [];

      await updateRecord(TABLES.INVOICES, invoiceId, updates);

      logActivity({
        action: "invoice_updated",
        description: `Invoice ${invoiceNumber} order link removed`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: invoiceId,
      });

      return NextResponse.json({ success: true, type: "unlink", matchStatus: "Open" });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error) {
    console.error("Match order error:", error);
    const msg = error instanceof Error ? error.message : "Failed to link order";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
