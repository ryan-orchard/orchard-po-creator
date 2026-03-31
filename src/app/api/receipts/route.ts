import { NextRequest, NextResponse } from "next/server";
import {
  getRecords,
  createRecord,
  createRecords,
  TABLES,
} from "@/lib/airtable";
import { generateNextNumber } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  // Fetch receipts with their line items
  const records = await getRecords(TABLES.RECEIPTS, {
    sort: [{ field: "Received Date", direction: "desc" }],
  });

  // Fetch all receipt lines, POs, warehouses, and SKUs for joining
  const [allLines, allPOs, allWarehouses, allSKUs] = await Promise.all([
    getRecords(TABLES.RECEIPT_LINES),
    getRecords(TABLES.PURCHASE_ORDERS),
    getRecords(TABLES.WAREHOUSES),
    getRecords(TABLES.SKUS),
  ]);

  // Build lookup maps
  const poMap: Record<string, string> = {};
  for (const po of allPOs) {
    poMap[po.id] = po.fields["PO Number"] as string;
  }

  const warehouseMap: Record<string, string> = {};
  for (const wh of allWarehouses) {
    warehouseMap[wh.id] = (wh.fields["Code"] as string) || (wh.fields["Name"] as string) || wh.id;
  }

  const skuMap: Record<string, string> = {};
  for (const sku of allSKUs) {
    skuMap[sku.id] = (sku.fields["Standard SKU"] as string) || (sku.fields["Name"] as string) || sku.id;
  }

  const lineMap: Record<string, typeof allLines> = {};
  for (const line of allLines) {
    const receiptIds = line.fields["Receipt"] as string[];
    if (receiptIds?.[0]) {
      if (!lineMap[receiptIds[0]]) lineMap[receiptIds[0]] = [];
      lineMap[receiptIds[0]].push(line);
    }
  }

  const receipts = records.map((r) => {
    const poIds = r.fields["Purchase Order"] as string[] | undefined;
    const warehouseIds = r.fields["Warehouses"] as string[] | undefined;
    const lines = lineMap[r.id] || [];

    return {
      id: r.id,
      receiptNumber: r.fields["Receipt Number"] as string,
      receivedDate: r.fields["Received Date"] as string,
      purchaseOrder: poIds?.[0] ? poMap[poIds[0]] : null,
      purchaseOrderId: poIds?.[0] || null,
      warehouse: warehouseIds?.[0] ? warehouseMap[warehouseIds[0]] : null,
      warehouseId: warehouseIds?.[0] || null,
      externalReceiptId: r.fields["External Receipt ID"] as string,
      stordReceiptId: r.fields["Stord Receipt ID"] as string | null,
      lines: lines.map((l) => {
        const skuIds = l.fields["SKU"] as string[] | undefined;
        return {
          id: l.id,
          sku: skuIds?.[0] ? skuMap[skuIds[0]] : null,
          skuId: skuIds?.[0] || null,
          qtyReceived: l.fields["Qty Received"] as number,
          threePlSku: l.fields["3PL SKU"] as string,
          lotNumber: l.fields["Lot Number"] as string,
        };
      }),
    };
  });

  return NextResponse.json(receipts);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const receiptNumber = await generateNextNumber(TABLES.RECEIPTS, "Receipt Number", "RCP");

  // Look up warehouse by code if facility code provided
  let warehouseId = body.warehouseId;
  if (!warehouseId && body.facilityCode) {
    const warehouses = await getRecords(TABLES.WAREHOUSES, {
      filterByFormula: `{Code} = "${body.facilityCode}"`,
    });
    if (warehouses.length > 0) {
      warehouseId = warehouses[0].id;
    }
  }

  // Create receipt header
  const receiptFields: Record<string, unknown> = {
    "Receipt Number": receiptNumber,
    "Received Date": body.receivedDate,
    ...(body.purchaseOrderId ? { "Purchase Order": [body.purchaseOrderId] } : {}),
    ...(warehouseId ? { Warehouses: [warehouseId] } : {}),
    ...(body.externalReceiptId ? { "External Receipt ID": body.externalReceiptId } : {}),
    ...(body.notes ? { Notes: body.notes } : {}),
  };

  const receipt = await createRecord(TABLES.RECEIPTS, receiptFields);

  // Create receipt line items
  if (body.lineItems && body.lineItems.length > 0) {
    const lineItemRecords = body.lineItems.map(
      (item: {
        skuId?: string;
        qtyReceived: number;
        threePlSku?: string;
        lotNumber?: string;
        poLineItemId?: string;
      },
        index: number
      ) => ({
        fields: {
          "Line ID": `${receiptNumber}-${index + 1}`,
          Receipt: [receipt.id],
          ...(item.skuId ? { SKU: [item.skuId] } : {}),
          "Qty Received": item.qtyReceived,
          ...(item.threePlSku ? { "3PL SKU": item.threePlSku } : {}),
          ...(item.lotNumber ? { "Lot Number": item.lotNumber } : {}),
          ...(item.poLineItemId
            ? { "PO Line Item": [item.poLineItemId], "Status": "Matched" }
            : { "Status": "Open" }),
        },
      })
    );

    await createRecords(TABLES.RECEIPT_LINES, lineItemRecords);
  }

  if (body.purchaseOrderId) {
    logActivity({
      poId: body.purchaseOrderId,
      action: "receipt_created",
      description: `Receipt ${receiptNumber} created`,
      actor: "Ryan Belanger",
      relatedRecordType: "receipt",
      relatedRecordId: receipt.id,
    });
  }

  return NextResponse.json({ id: receipt.id, receiptNumber });
}
