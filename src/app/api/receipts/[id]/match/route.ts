import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, updateRecord, TABLES } from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

/**
 * PATCH /api/receipts/[id]/match
 *
 * Links a receipt to a PO or WO at header level AND links individual receipt
 * lines to their corresponding source line items. Updates source status.
 *
 * PO match body: {
 *   purchaseOrderId: string,
 *   lineMatches: { receiptLineId: string, poLineItemId: string }[]
 * }
 *
 * WO match body: {
 *   workOrderId: string,
 *   lineMatches: { receiptLineId: string, woLineItemId: string }[]
 * }
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

    // Route to the appropriate handler
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

// --- PO matching (existing logic) ---

async function handlePOMatch(
  receiptId: string,
  purchaseOrderId: string,
  lineMatches: { receiptLineId: string; poLineItemId: string }[]
) {
  const po = await getRecord(TABLES.PURCHASE_ORDERS, purchaseOrderId);
  if (!po || po.id !== purchaseOrderId) {
    return NextResponse.json(
      { error: "Purchase Order not found" },
      { status: 404 }
    );
  }

  // 1. Link receipt lines to PO line items and set Match Status
  if (lineMatches.length > 0) {
    await Promise.all(
      lineMatches
        .filter((m) => m.receiptLineId && m.poLineItemId)
        .map((m) =>
          updateRecord(TABLES.RECEIPT_LINES, m.receiptLineId, {
            "PO Line Item": [m.poLineItemId],
            "Match Status": "Matched",
          })
        )
    );
  }

  // 2. Check if ALL receipt lines are now matched — only then set header PO link
  const [allPOLineItems, allReceipts, allReceiptLines, allItems] = await Promise.all([
    getRecords(TABLES.PO_LINE_ITEMS),
    getRecords(TABLES.RECEIPTS),
    getRecords(TABLES.RECEIPT_LINES),
    getRecords(TABLES.SKUS),
  ]);

  const thisReceiptLines = allReceiptLines.filter((rl) => {
    const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
    return rlReceiptIds?.[0] === receiptId;
  });
  const allLinesMatched = thisReceiptLines.length > 0 && thisReceiptLines.every((rl) => {
    const poLineItemLink = rl.fields["PO Line Item"] as string[] | undefined;
    return poLineItemLink && poLineItemLink.length > 0;
  });

  if (allLinesMatched) {
    await updateRecord(TABLES.RECEIPTS, receiptId, {
      "Purchase Order": [purchaseOrderId],
    });
  }

  // 3. Calculate PO status based on cumulative receipts
  const poLineItems = allPOLineItems.filter((li) => {
    const poLinks = li.fields["Purchase Order"] as string[] | undefined;
    return poLinks?.[0] === purchaseOrderId;
  });

  const poReceiptIds = allReceipts
    .filter((r) => {
      const poIds = r.fields["Purchase Order"] as string[] | undefined;
      return poIds?.[0] === purchaseOrderId;
    })
    .map((r) => r.id);
  if (allLinesMatched && !poReceiptIds.includes(receiptId)) {
    poReceiptIds.push(receiptId);
  }

  const relevantReceiptLines = allReceiptLines.filter((rl) => {
    const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
    return rlReceiptIds?.[0] && poReceiptIds.includes(rlReceiptIds[0]);
  });

  const receivedBySku: Record<string, number> = {};
  for (const rl of relevantReceiptLines) {
    const skuIds = rl.fields["SKU"] as string[] | undefined;
    const skuId = skuIds?.[0];
    if (skuId) {
      receivedBySku[skuId] = (receivedBySku[skuId] || 0) + ((rl.fields["Qty Received"] as number) || 0);
    }
  }

  const itemUOM: Record<string, string> = {};
  for (const item of allItems) {
    itemUOM[item.id] = (item.fields["UOM"] as string) || "Each";
  }

  let allFullyReceived = true;
  let anyReceived = false;

  for (const poLine of poLineItems) {
    const skuIds = poLine.fields["SKU"] as string[] | undefined;
    const skuId = skuIds?.[0];
    if (!skuId) continue;

    const uom = itemUOM[skuId] || "Each";
    const orderedQty = uom === "Carton"
      ? ((poLine.fields["Qty Cartons"] as number) || 0)
      : ((poLine.fields["Qty Sticks"] as number) || (poLine.fields["Qty Cartons"] as number) || 0);

    const receivedQty = receivedBySku[skuId] || 0;
    if (receivedQty > 0) anyReceived = true;
    if (receivedQty < orderedQty) allFullyReceived = false;
  }

  let newPoStatus: string | null = null;
  const currentStatus = po.fields["Status"] as string;

  if (allFullyReceived && anyReceived && poLineItems.length > 0) {
    newPoStatus = "Received";
  } else if (anyReceived) {
    newPoStatus = "Partially Received";
  }

  if (newPoStatus && currentStatus !== newPoStatus) {
    const validTransitions: Record<string, string[]> = {
      "Issued": ["Partially Received", "Received"],
      "Partially Received": ["Received"],
    };
    if (validTransitions[currentStatus]?.includes(newPoStatus)) {
      await updateRecord(TABLES.PURCHASE_ORDERS, purchaseOrderId, {
        Status: newPoStatus,
      });
    }
  }

  // Log activity
  const totalQtyReceived = thisReceiptLines.reduce(
    (sum, rl) => sum + ((rl.fields["Qty Received"] as number) || 0),
    0
  );
  logActivity({
    poId: purchaseOrderId,
    action: "receipt_matched",
    description: totalQtyReceived > 0
      ? `Matched ${totalQtyReceived.toLocaleString()} units`
      : "Receipt matched",
    actor: "Ryan Belanger",
    relatedRecordType: "receipt",
    relatedRecordId: receiptId,
  });

  return NextResponse.json({
    success: true,
    receiptId,
    purchaseOrderId,
    poStatus: newPoStatus || currentStatus,
    linesMatched: lineMatches.length,
  });
}

// --- WO matching ---

async function handleWOMatch(
  receiptId: string,
  workOrderId: string,
  lineMatches: { receiptLineId: string; woLineItemId: string }[]
) {
  const wo = await getRecord(TABLES.WORK_ORDERS, workOrderId);
  if (!wo || wo.id !== workOrderId) {
    return NextResponse.json(
      { error: "Work Order not found" },
      { status: 404 }
    );
  }

  // 1. Link receipt lines to WO line items and set Match Status
  if (lineMatches.length > 0) {
    await Promise.all(
      lineMatches
        .filter((m) => m.receiptLineId && m.woLineItemId)
        .map((m) =>
          updateRecord(TABLES.RECEIPT_LINES, m.receiptLineId, {
            "Work Order Lines": [m.woLineItemId],
            "Match Status": "Matched",
          })
        )
    );
  }

  // 2. Check if ALL receipt lines are now matched — then set header WO link
  const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
  const thisReceiptLines = allReceiptLines.filter((rl) => {
    const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
    return rlReceiptIds?.[0] === receiptId;
  });

  const allLinesMatched = thisReceiptLines.length > 0 && thisReceiptLines.every((rl) => {
    const woLineItemLink = rl.fields["Work Order Lines"] as string[] | undefined;
    const poLineItemLink = rl.fields["PO Line Item"] as string[] | undefined;
    return (woLineItemLink && woLineItemLink.length > 0) || (poLineItemLink && poLineItemLink.length > 0);
  });

  if (allLinesMatched) {
    await updateRecord(TABLES.RECEIPTS, receiptId, {
      "Work Order": [workOrderId],
    });
  }

  // Log activity
  const woNumber = wo.fields["WO Number"] as string;
  const totalQtyReceived = thisReceiptLines.reduce(
    (sum, rl) => sum + ((rl.fields["Qty Received"] as number) || 0),
    0
  );

  logActivity({
    woId: workOrderId,
    action: "receipt_matched",
    description: totalQtyReceived > 0
      ? `Matched ${totalQtyReceived.toLocaleString()} units to ${woNumber}`
      : `Receipt matched to ${woNumber}`,
    actor: "Ryan Belanger",
    relatedRecordType: "receipt",
    relatedRecordId: receiptId,
  });

  return NextResponse.json({
    success: true,
    receiptId,
    workOrderId,
    woStatus: wo.fields["Status"] as string,
    linesMatched: lineMatches.length,
  });
}
