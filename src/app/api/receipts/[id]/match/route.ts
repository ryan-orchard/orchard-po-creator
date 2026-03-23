import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, updateRecord, TABLES } from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

/**
 * PATCH /api/receipts/[id]/match
 *
 * Links a receipt to a PO at header level AND links individual receipt lines
 * to their corresponding PO line items. Updates PO status based on
 * cumulative receipt coverage.
 *
 * Body: {
 *   purchaseOrderId: string,
 *   lineMatches: { receiptLineId: string, poLineItemId: string }[]
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: receiptId } = await params;
    const body = await request.json();
    const { purchaseOrderId, lineMatches } = body as {
      purchaseOrderId: string;
      lineMatches?: { receiptLineId: string; poLineItemId: string }[];
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

    // 1. Link receipt lines to PO line items and set Match Status
    if (lineMatches && lineMatches.length > 0) {
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

    // Check if all receipt lines now have PO Line Item links
    const thisReceiptLines = allReceiptLines.filter((rl) => {
      const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
      return rlReceiptIds?.[0] === receiptId;
    });
    const allLinesMatched = thisReceiptLines.length > 0 && thisReceiptLines.every((rl) => {
      const poLineItemLink = rl.fields["PO Line Item"] as string[] | undefined;
      return poLineItemLink && poLineItemLink.length > 0;
    });

    // Only set header Receipt → PO link when all lines are matched
    if (allLinesMatched) {
      await updateRecord(TABLES.RECEIPTS, receiptId, {
        "Purchase Order": [purchaseOrderId],
      });
    }

    // 3. Calculate PO status based on cumulative receipts
    // Filter PO line items for this PO
    const poLineItems = allPOLineItems.filter((li) => {
      const poLinks = li.fields["Purchase Order"] as string[] | undefined;
      return poLinks?.[0] === purchaseOrderId;
    });

    // Filter receipts linked to this PO
    // Include current receipt if all lines were just matched (header link was set above
    // but allReceipts was fetched before that update)
    const poReceiptIds = allReceipts
      .filter((r) => {
        const poIds = r.fields["Purchase Order"] as string[] | undefined;
        return poIds?.[0] === purchaseOrderId;
      })
      .map((r) => r.id);
    if (allLinesMatched && !poReceiptIds.includes(receiptId)) {
      poReceiptIds.push(receiptId);
    }

    // Filter receipt lines for those receipts
    const relevantReceiptLines = allReceiptLines.filter((rl) => {
      const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
      return rlReceiptIds?.[0] && poReceiptIds.includes(rlReceiptIds[0]);
    });

    // Aggregate received qty by SKU across all receipts
    const receivedBySku: Record<string, number> = {};
    for (const rl of relevantReceiptLines) {
      const skuIds = rl.fields["SKU"] as string[] | undefined;
      const skuId = skuIds?.[0];
      if (skuId) {
        receivedBySku[skuId] = (receivedBySku[skuId] || 0) + ((rl.fields["Qty Received"] as number) || 0);
      }
    }

    // Build UOM lookup
    const itemUOM: Record<string, string> = {};
    for (const item of allItems) {
      itemUOM[item.id] = (item.fields["UOM"] as string) || "Each";
    }

    // Compare PO line items vs cumulative received qty
    let allFullyReceived = true;
    let anyReceived = false;

    for (const poLine of poLineItems) {
      const skuIds = poLine.fields["SKU"] as string[] | undefined;
      const skuId = skuIds?.[0];
      if (!skuId) continue;

      const uom = itemUOM[skuId] || "Each";
      // Use Qty Cartons for Carton items, Qty Sticks for Stick items,
      // and fall back to Qty Cartons for Each items (PO Creator stores qty there)
      const orderedQty = uom === "Carton"
        ? ((poLine.fields["Qty Cartons"] as number) || 0)
        : ((poLine.fields["Qty Sticks"] as number) || (poLine.fields["Qty Cartons"] as number) || 0);

      const receivedQty = receivedBySku[skuId] || 0;

      if (receivedQty > 0) {
        anyReceived = true;
      }
      if (receivedQty < orderedQty) {
        allFullyReceived = false;
      }
    }

    // 4. Determine new PO status
    let newPoStatus: string | null = null;
    const currentStatus = po.fields["Status"] as string;

    if (allFullyReceived && anyReceived && poLineItems.length > 0) {
      newPoStatus = "Received";
    } else if (anyReceived) {
      newPoStatus = "Partially Received";
    }

    // Only update if status is changing and transition is valid
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

    // Log receipt matched activity with qty and date details
    const receiptRecord = await getRecord(TABLES.RECEIPTS, receiptId);
    const receiptDate = receiptRecord?.fields["Date"] as string;
    const totalQtyReceived = thisReceiptLines.reduce(
      (sum, rl) => sum + ((rl.fields["Qty Received"] as number) || 0),
      0
    );
    const formattedDate = receiptDate
      ? new Date(receiptDate + "T00:00:00").toLocaleDateString("en-US", {
          month: "numeric",
          day: "numeric",
          year: "numeric",
        })
      : "";
    const qtyDesc = totalQtyReceived > 0
      ? `Matched ${totalQtyReceived.toLocaleString()} units${formattedDate ? ` received on ${formattedDate}` : ""}`
      : `Receipt matched`;
    logActivity({
      poId: purchaseOrderId,
      action: "receipt_matched",
      description: qtyDesc,
      actor: "Ryan Belanger",
      relatedRecordType: "receipt",
      relatedRecordId: receiptId,
    });

    return NextResponse.json({
      success: true,
      receiptId,
      purchaseOrderId,
      poStatus: newPoStatus || currentStatus,
      linesMatched: lineMatches?.length || 0,
    });
  } catch (error) {
    console.error("Match error:", error);
    return NextResponse.json(
      { error: `Failed to match receipt: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
