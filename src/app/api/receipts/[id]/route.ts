import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, updateRecord, TABLES } from "@/lib/airtable";
import { SKU_MAPPING } from "@/lib/client-config";

/**
 * GET /api/receipts/[id]
 *
 * Returns a single receipt with full line item details.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const receipt = await getRecord(TABLES.RECEIPTS, id);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    // Fetch related data in parallel
    const [allLines, allPOs, allWarehouses, allSKUs] = await Promise.all([
      getRecords(TABLES.RECEIPT_LINES),
      getRecords(TABLES.PURCHASE_ORDERS),
      getRecords(TABLES.WAREHOUSES),
      getRecords(TABLES.SKUS),
    ]);

    // Filter lines for this receipt
    const receiptLines = allLines.filter((rl) => {
      const receiptIds = rl.fields["Receipt"] as string[] | undefined;
      return receiptIds?.[0] === id;
    });

    // Build lookup maps
    const poMap: Record<string, { poNumber: string; id: string }> = {};
    for (const po of allPOs) {
      poMap[po.id] = { poNumber: po.fields["PO Number"] as string, id: po.id };
    }

    const warehouseMap: Record<string, string> = {};
    for (const wh of allWarehouses) {
      warehouseMap[wh.id] = (wh.fields["Code"] as string) || (wh.fields["Name"] as string) || wh.id;
    }

    const skuMap: Record<string, { standardSku: string; uom: string }> = {};
    for (const sku of allSKUs) {
      skuMap[sku.id] = {
        standardSku: (sku.fields["Standard SKU"] as string) || (sku.fields["Name"] as string) || sku.id,
        uom: (sku.fields["UOM"] as string) || "Each",
      };
    }

    const poIds = receipt.fields["Purchase Order"] as string[] | undefined;
    const warehouseIds = receipt.fields["Warehouses"] as string[] | undefined;
    const poInfo = poIds?.[0] ? poMap[poIds[0]] : null;

    // Available items for SKU editing
    const availableItems = allSKUs
      .filter((item) => (item.fields["Status"] as string) !== "Inactive")
      .map((item) => ({
        id: item.id,
        standardSku: (item.fields["Standard SKU"] as string) || (item.fields["Name"] as string) || item.id,
      }))
      .sort((a, b) => a.standardSku.localeCompare(b.standardSku));

    const lines = receiptLines.map((l) => {
      const skuIds = l.fields["SKU"] as string[] | undefined;
      let skuId = skuIds?.[0] || null;
      const threePlSku = (l.fields["3PL SKU"] as string) || null;
      const poLineItemLink = l.fields["PO Line Item"] as string[] | undefined;

      // Fallback: resolve from 3PL SKU mapping if no direct SKU link
      if (!skuId && threePlSku) {
        const mapping = SKU_MAPPING[threePlSku];
        if (mapping) skuId = mapping.airtableId;
      }

      const skuInfo = skuId ? skuMap[skuId] : null;

      return {
        id: l.id,
        skuId,
        sku: skuInfo?.standardSku || null,
        uom: skuInfo?.uom || null,
        qtyReceived: (l.fields["Qty Received"] as number) || 0,
        qtyExpected: (l.fields["Qty Expected"] as number) || null,
        threePlSku,
        lotNumber: (l.fields["Lot Number"] as string) || null,
        matched: !!(poLineItemLink && poLineItemLink.length > 0),
      };
    });

    return NextResponse.json({
      id: receipt.id,
      receiptNumber: receipt.fields["Receipt Number"] as string,
      receivedDate: receipt.fields["Received Date"] as string,
      externalReceiptId: (receipt.fields["External Receipt ID"] as string) || null,
      notes: (receipt.fields["Notes"] as string) || null,
      purchaseOrder: poInfo?.poNumber || null,
      purchaseOrderId: poInfo?.id || null,
      warehouse: warehouseIds?.[0] ? warehouseMap[warehouseIds[0]] : null,
      warehouseId: warehouseIds?.[0] || null,
      lines,
      availableItems,
    });
  } catch (error) {
    console.error("Get receipt error:", error);
    return NextResponse.json(
      { error: `Failed to get receipt: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/receipts/[id]
 *
 * Update receipt header fields (notes, externalReceiptId).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.notes !== undefined) updates["Notes"] = body.notes;
    if (body.externalReceiptId !== undefined) updates["External Receipt ID"] = body.externalReceiptId;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await updateRecord(TABLES.RECEIPTS, id, updates);
    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Update receipt error:", error);
    return NextResponse.json(
      { error: `Failed to update: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
