import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";
import { setReceiptLineStatuses } from "@/lib/receipt-status";

/**
 * PATCH /api/receipts/[id]/match
 *
 * Links a receipt to a PO or WO:
 *
 * PO match: insert into po_line_receipt_line_links per line, update receipt.po_id
 * Body: { purchaseOrderId, lineMatches: [{ receiptLineId, poLineItemId }] }
 *
 * WO match: insert into wo_receipt_links (header-level), update receipt line statuses
 * Body: { workOrderId, lineMatches: [{ receiptLineId, woLineItemId }] }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: receiptId } = await params;
    const body = await request.json();
    const { purchaseOrderId, workOrderId } = body as {
      purchaseOrderId?: string;
      workOrderId?: string;
    };

    if (!purchaseOrderId && !workOrderId) {
      return NextResponse.json(
        { error: "purchaseOrderId or workOrderId is required" },
        { status: 400 }
      );
    }

    if (workOrderId) {
      return handleWOMatch(receiptId, workOrderId, body.lineMatches || []);
    } else {
      return handlePOMatch(receiptId, purchaseOrderId!, body.lineMatches || []);
    }
  } catch (error) {
    console.error("Match error:", error);
    return NextResponse.json(
      { error: `Failed to match receipt: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

async function handlePOMatch(
  receiptId: string,
  purchaseOrderId: string,
  lineMatches: { receiptLineId: string; poLineItemId: string }[]
) {
  const { data: po } = await db
    .schema("orchard")
    .from("purchase_orders")
    .select("id, po_number")
    .eq("id", purchaseOrderId)
    .maybeSingle();

  if (!po) return NextResponse.json({ error: "Purchase Order not found" }, { status: 404 });

  const validMatches = lineMatches.filter((m) => m.receiptLineId && m.poLineItemId);

  if (validMatches.length > 0) {
    // Insert link table entries — ignore conflicts (idempotent)
    await db.schema("orchard_calcs").from("po_line_receipt_line_links").upsert(
      validMatches.map((m) => ({ po_line_id: m.poLineItemId, receipt_line_id: m.receiptLineId })),
      { onConflict: "po_line_id,receipt_line_id" }
    );

    // Update receipt_lines status to Matched (Silver)
    await setReceiptLineStatuses(validMatches.map((m) => m.receiptLineId), "Matched", "Ryan Belanger");
  }

  // Update receipt.po_id (denorm for display)
  await db.schema("orchard").from("receipts").update({ po_id: purchaseOrderId }).eq("id", receiptId);

  // Log activity
  const { data: receiptLines } = await db
    .schema("orchard")
    .from("receipt_lines")
    .select("qty_received")
    .eq("receipt_id", receiptId);
  const totalQty = (receiptLines ?? []).reduce((sum, rl) => sum + (Number(rl.qty_received) || 0), 0);

  logActivity({
    poId: purchaseOrderId,
    action: "receipt_matched",
    description: totalQty > 0 ? `Matched ${totalQty.toLocaleString()} units` : "Receipt matched",
    actor: "Ryan Belanger",
    relatedRecordType: "receipt",
    relatedRecordId: receiptId,
  });

  return NextResponse.json({
    success: true,
    receiptId,
    purchaseOrderId,
    linesMatched: validMatches.length,
  });
}

async function handleWOMatch(
  receiptId: string,
  workOrderId: string,
  lineMatches: { receiptLineId: string; woLineItemId: string }[]
) {
  const { data: wo } = await db
    .schema("orchard")
    .from("work_orders")
    .select("id, wo_number, status")
    .eq("id", workOrderId)
    .maybeSingle();

  if (!wo) return NextResponse.json({ error: "Work Order not found" }, { status: 404 });

  // Insert WO-receipt header link
  await db
    .schema("orchard_calcs")
    .from("wo_receipt_links")
    .upsert({ wo_id: workOrderId, receipt_id: receiptId }, { onConflict: "wo_id,receipt_id" });

  // Update receipt line statuses to Matched (Silver)
  const validMatches = lineMatches.filter((m) => m.receiptLineId);
  await setReceiptLineStatuses(validMatches.map((m) => m.receiptLineId), "Matched", "Ryan Belanger");

  // Log activity
  const { data: receiptLines } = await db
    .schema("orchard")
    .from("receipt_lines")
    .select("qty_received")
    .eq("receipt_id", receiptId);
  const totalQty = (receiptLines ?? []).reduce((sum, rl) => sum + (Number(rl.qty_received) || 0), 0);

  logActivity({
    woId: workOrderId,
    action: "receipt_matched",
    description:
      totalQty > 0
        ? `Matched ${totalQty.toLocaleString()} units to ${wo.wo_number}`
        : `Receipt matched to ${wo.wo_number}`,
    actor: "Ryan Belanger",
    relatedRecordType: "receipt",
    relatedRecordId: receiptId,
  });

  return NextResponse.json({
    success: true,
    receiptId,
    workOrderId,
    woStatus: wo.status,
    linesMatched: validMatches.length,
  });
}
