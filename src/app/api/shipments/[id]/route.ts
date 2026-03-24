import { NextRequest, NextResponse } from "next/server";
import {
  getRecord,
  updateRecord,
  deleteRecord,
  TABLES,
} from "@/lib/airtable";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const record = await getRecord(TABLES.SHIPMENTS, id);

    if (!record || !record.id) {
      return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
    }

    // Fetch PO details
    const poIds = (record.fields["Purchase Order"] as string[]) || [];
    const po = poIds[0]
      ? await getRecord(TABLES.PURCHASE_ORDERS, poIds[0])
      : null;

    // Fetch ship-to from shipment (or fall back to PO)
    const shipToIds = (record.fields["Ship To"] as string[]) || [];
    let shipToId = shipToIds[0] || null;
    // Fall back to PO's Ship To if shipment doesn't have one
    if (!shipToId && po) {
      const poShipToIds = (po.fields["Ship To"] as string[]) || [];
      shipToId = poShipToIds[0] || null;
    }
    let shipTo = null;
    if (shipToId) {
      const shipToRecord = await getRecord(TABLES.SHIP_TO, shipToId);
      shipTo = {
        id: shipToRecord.id,
        name: shipToRecord.fields["Name"] as string,
        address: shipToRecord.fields["Address"] as string,
        city: shipToRecord.fields["City"] as string,
        state: shipToRecord.fields["State"] as string,
        zip: shipToRecord.fields["Zip"] as string,
      };
    }

    // Fetch shipment lines
    const lineItemIds = (record.fields["Shipment Lines"] as string[]) || [];
    const lineItems = await Promise.all(
      lineItemIds.map((liId: string) =>
        getRecord(TABLES.SHIPMENT_LINES, liId)
      )
    );

    // Fetch SKU details for each line item
    const lineItemsWithSkus = await Promise.all(
      lineItems.map(async (li) => {
        const skuIds = (li.fields["SKU"] as string[]) || [];
        const sku = skuIds[0]
          ? await getRecord(TABLES.SKUS, skuIds[0])
          : null;
        return {
          id: li.id,
          skuId: skuIds[0] || null,
          sku: sku
            ? {
                standardSku: sku.fields["Standard SKU"] as string,
                flavor: sku.fields["Flavor"] as string,
                sticksPerCarton: sku.fields["Sticks per Carton"] as number | null,
                category: sku.fields["Category"] as string,
              }
            : null,
          qtyShipped: li.fields["Qty Shipped"] as number,
        };
      })
    );

    // Fetch supplier name from PO
    let supplierName = null;
    if (po) {
      const supplierIds = (po.fields["Supplier"] as string[]) || [];
      if (supplierIds[0]) {
        const supplier = await getRecord(TABLES.SUPPLIERS, supplierIds[0]);
        supplierName = supplier.fields["Supplier Name"] as string;
      }
    }

    return NextResponse.json({
      id: record.id,
      shipmentNumber: record.fields["Shipment Number"] as string,
      purchaseOrderId: poIds[0] || null,
      poNumber: po ? (po.fields["PO Number"] as string) : null,
      supplierName,
      shipDate: record.fields["Ship Date"] as string,
      expectedDeliveryDate: record.fields["Estimated Delivery"] as string,
      carrier: record.fields["Carrier"] as string,
      carrierReference: record.fields["Carrier Reference"] as string,
      trackingNumber: record.fields["Tracking Number"] as string,
      notes: record.fields["Notes"] as string,
      shipToId,
      shipTo,
      status: record.fields["Status"] as string,
      lineItems: lineItemsWithSkus,
    });
  } catch {
    return NextResponse.json({ error: "Shipment not found" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get shipment to find its line items
    const record = await getRecord(TABLES.SHIPMENTS, id);
    const lineItemIds = (record.fields["Shipment Lines"] as string[]) || [];

    // Delete line items first
    for (const liId of lineItemIds) {
      await deleteRecord(TABLES.SHIPMENT_LINES, liId);
    }

    // Delete the shipment
    await deleteRecord(TABLES.SHIPMENTS, id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete shipment" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    await updateRecord(TABLES.SHIPMENTS, id, {
      "Ship Date": body.shipDate,
      "Estimated Delivery": body.expectedDeliveryDate || null,
      Carrier: body.carrier || "",
      "Carrier Reference": body.carrierReference || "",
      "Tracking Number": body.trackingNumber || "",
      ...(body.shipToId ? { "Ship To": [body.shipToId] } : {}),
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to update shipment" },
      { status: 500 }
    );
  }
}
