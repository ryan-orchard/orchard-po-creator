import { NextRequest, NextResponse } from "next/server";
import {
  getRecords,
  createRecord,
  createRecords,
  TABLES,
} from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  const records = await getRecords(TABLES.SHIPMENTS, {
    sort: [{ field: "Ship Date", direction: "desc" }],
  });

  const shipments = records.map((r) => ({
    id: r.id,
    shipmentNumber: r.fields["Shipment Number"] as string,
    purchaseOrder: r.fields["Purchase Order"] as string[],
    workOrder: r.fields["Work Order"] as string[],
    shipDate: r.fields["Ship Date"] as string,
    expectedDeliveryDate: r.fields["Estimated Delivery"] as string,
    carrier: r.fields["Carrier"] as string,
    carrierReference: r.fields["Carrier Reference"] as string,
    trackingNumber: r.fields["Tracking Number"] as string,
    shipTo: r.fields["Ship To"] as string[],
    status: r.fields["Status"] as string,
    shipmentLines: r.fields["Shipment Lines"] as string[],
  }));

  return NextResponse.json(shipments);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Generate Shipment number: SH-10001, SH-10002, ...
  const existingShipments = await getRecords(TABLES.SHIPMENTS);
  let maxNum = 10000;
  for (const r of existingShipments) {
    const num = r.fields["Shipment Number"] as string;
    const match = num?.match(/^SH-(\d+)$/);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  const shipmentNumber = `SH-${maxNum + 1}`;

  // Build header fields — link to either PO or WO
  const headerFields: Record<string, unknown> = {
    "Shipment Number": shipmentNumber,
    "Ship Date": body.shipDate,
    "Estimated Delivery": body.expectedDeliveryDate || null,
    Carrier: body.carrier || "",
    "Carrier Reference": body.carrierReference || "",
    "Tracking Number": body.trackingNumber || "",
    Status: "Created",
  };

  if (body.purchaseOrderId) {
    headerFields["Purchase Order"] = [body.purchaseOrderId];
  }
  if (body.workOrderId) {
    headerFields["Work Order"] = [body.workOrderId];
  }
  if (body.shipToId) {
    headerFields["Ship To"] = [body.shipToId];
  }

  const shipment = await createRecord(TABLES.SHIPMENTS, headerFields);

  // Create shipment line items
  if (body.lineItems && body.lineItems.length > 0) {
    const lineItemRecords = body.lineItems.map(
      (item: {
        skuId: string;
        qtyShipped: number;
      }) => ({
        fields: {
          Shipment: [shipment.id],
          SKU: [item.skuId],
          "Qty Shipped": item.qtyShipped,
        },
      })
    );

    await createRecords(TABLES.SHIPMENT_LINES, lineItemRecords);
  }

  // Log activity to the appropriate source document
  logActivity({
    poId: body.purchaseOrderId || undefined,
    woId: body.workOrderId || undefined,
    action: "shipment_created",
    description: `Shipment ${shipmentNumber} created`,
    actor: "Ryan Belanger",
    relatedRecordType: "shipment",
    relatedRecordId: shipment.id,
  });

  return NextResponse.json({ id: shipment.id, shipmentNumber });
}
