import { NextRequest, NextResponse } from "next/server";
import { getRecords, updateRecord, TABLES } from "@/lib/airtable";

/**
 * POST /api/receipt-lines/[id]/unmatch
 *
 * Clears the PO Line Item link on a receipt line, sets Match Status to Open,
 * and removes the receipt header PO link if it was set.
 * Recalculates PO status after unlinking.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: receiptLineId } = await params;

    // Fetch the receipt line to get its receipt ID and current PO Line Item link
    const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
    const receiptLine = allReceiptLines.find((rl) => rl.id === receiptLineId);
    if (!receiptLine) {
      return NextResponse.json(
        { error: "Receipt line not found" },
        { status: 404 }
      );
    }

    const poLineItemLinks = receiptLine.fields["PO Line Item"] as string[] | undefined;
    const receiptIds = receiptLine.fields["Receipt"] as string[] | undefined;
    const receiptId = receiptIds?.[0];

    if (!poLineItemLinks?.[0]) {
      return NextResponse.json(
        { error: "Receipt line is not matched" },
        { status: 400 }
      );
    }

    // Find which PO this PO Line Item belongs to
    const allPOLineItems = await getRecords(TABLES.PO_LINE_ITEMS);
    const poLineItem = allPOLineItems.find((li) => li.id === poLineItemLinks[0]);
    const poLinks = poLineItem?.fields["Purchase Order"] as string[] | undefined;
    const poId = poLinks?.[0];

    // 1. Clear the PO Line Item link and set Match Status to Open
    await updateRecord(TABLES.RECEIPT_LINES, receiptLineId, {
      "PO Line Item": [],
      "Match Status": "Open",
    });

    // 2. Clear the receipt header PO link (since at least one line is now unmatched)
    if (receiptId) {
      const allReceipts = await getRecords(TABLES.RECEIPTS);
      const receipt = allReceipts.find((r) => r.id === receiptId);
      const receiptPOLink = receipt?.fields["Purchase Order"] as string[] | undefined;
      if (receiptPOLink?.length) {
        await updateRecord(TABLES.RECEIPTS, receiptId, {
          "Purchase Order": [],
        });
      }
    }

    // 3. Recalculate PO status if we know which PO was linked
    if (poId) {
      const allItems = await getRecords(TABLES.SKUS);
      const itemUOM: Record<string, string> = {};
      for (const item of allItems) {
        itemUOM[item.id] = (item.fields["UOM"] as string) || "Each";
      }

      // Get all receipts still linked to this PO
      const allReceipts = await getRecords(TABLES.RECEIPTS);
      const poReceiptIds = allReceipts
        .filter((r) => {
          const rPoIds = r.fields["Purchase Order"] as string[] | undefined;
          return rPoIds?.[0] === poId;
        })
        .map((r) => r.id);

      // Re-fetch receipt lines to get updated state
      const freshReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
      const relevantReceiptLines = freshReceiptLines.filter((rl) => {
        const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
        return rlReceiptIds?.[0] && poReceiptIds.includes(rlReceiptIds[0]);
      });

      // Aggregate received qty by SKU
      const receivedBySku: Record<string, number> = {};
      for (const rl of relevantReceiptLines) {
        const skuIds = rl.fields["SKU"] as string[] | undefined;
        const skuId = skuIds?.[0];
        if (skuId) {
          receivedBySku[skuId] =
            (receivedBySku[skuId] || 0) +
            ((rl.fields["Qty Received"] as number) || 0);
        }
      }

      // Check PO line items
      const poLineItems = allPOLineItems.filter((li) => {
        const plPoLinks = li.fields["Purchase Order"] as string[] | undefined;
        return plPoLinks?.[0] === poId;
      });

      let allFullyReceived = true;
      let anyReceived = false;

      for (const poLine of poLineItems) {
        const skuIds = poLine.fields["SKU"] as string[] | undefined;
        const skuId = skuIds?.[0];
        if (!skuId) continue;

        const uom = itemUOM[skuId] || "Each";
        const orderedQty =
          uom === "Carton"
            ? (poLine.fields["Qty Cartons"] as number) || 0
            : (poLine.fields["Qty Sticks"] as number) ||
              (poLine.fields["Qty Cartons"] as number) ||
              0;
        const receivedQty = receivedBySku[skuId] || 0;

        if (receivedQty > 0) anyReceived = true;
        if (receivedQty < orderedQty) allFullyReceived = false;
      }

      let newStatus: string;
      if (allFullyReceived && anyReceived && poLineItems.length > 0) {
        newStatus = "Received";
      } else if (anyReceived) {
        newStatus = "Partially Received";
      } else {
        newStatus = "Issued";
      }

      await updateRecord(TABLES.PURCHASE_ORDERS, poId, {
        Status: newStatus,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unmatch error:", error);
    return NextResponse.json(
      {
        error: `Failed to unmatch: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
