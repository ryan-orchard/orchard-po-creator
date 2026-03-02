import { NextRequest, NextResponse } from "next/server";
import {
  getRecord,
  updateRecord,
  deleteRecord,
  createRecords,
  TABLES,
} from "@/lib/airtable";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const record = await getRecord(TABLES.PURCHASE_ORDERS, id);

    if (!record || !record.id) {
      return NextResponse.json({ error: "PO not found" }, { status: 404 });
    }

    // Fetch supplier details
    const supplierIds = (record.fields["Supplier"] as string[]) || [];
    const supplier = supplierIds[0]
      ? await getRecord(TABLES.SUPPLIERS, supplierIds[0])
      : null;

    // Fetch ship-to details
    const shipToIds = (record.fields["Ship To"] as string[]) || [];
    const shipTo = shipToIds[0]
      ? await getRecord(TABLES.SHIP_TO, shipToIds[0])
      : null;

    // Fetch line items
    const lineItemIds = (record.fields["PO Line Items"] as string[]) || [];
    const lineItems = await Promise.all(
      lineItemIds.map((liId: string) =>
        getRecord(TABLES.PO_LINE_ITEMS, liId)
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
                count: sku.fields["Count"] as string,
                category: sku.fields["Category"] as string,
              }
            : null,
          section: li.fields["Section"] as string,
          qtySticks: li.fields["Qty Sticks"] as number,
          qtyCartons: li.fields["Qty Cartons"] as number,
          unitCost: li.fields["Unit Cost"] as number,
          costBasis: li.fields["Cost Basis"] as string,
          totalPrice: li.fields["Total Price"] as number,
        };
      })
    );

    return NextResponse.json({
      id: record.id,
      poNumber: record.fields["PO Number"] as string,
      date: record.fields["Date"] as string,
      status: record.fields["Status"] as string,
      deliveryDate: record.fields["Delivery Date"] as string,
      shippingTerms: record.fields["Shipping Terms"] as string,
      paymentTerms: record.fields["Payment Terms"] as string,
      notes: record.fields["Notes"] as string,
      grandTotal: record.fields["Grand Total"] as number,
      supplierId: supplierIds[0] || null,
      shipToId: shipToIds[0] || null,
      supplier: supplier
        ? {
            id: supplier.id,
            name: supplier.fields["Supplier Name"] as string,
            address: supplier.fields["Address"] as string,
            city: supplier.fields["City"] as string,
            state: supplier.fields["State"] as string,
            zip: supplier.fields["Zip"] as string,
          }
        : null,
      shipTo: shipTo
        ? {
            id: shipTo.id,
            name: shipTo.fields["Name"] as string,
            address: shipTo.fields["Address"] as string,
            city: shipTo.fields["City"] as string,
            state: shipTo.fields["State"] as string,
            zip: shipTo.fields["Zip"] as string,
          }
        : null,
      lineItems: lineItemsWithSkus,
    });
  } catch {
    return NextResponse.json({ error: "PO not found" }, { status: 404 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    // Update PO header
    const po = await updateRecord(TABLES.PURCHASE_ORDERS, id, {
      Date: body.date,
      Supplier: [body.supplierId],
      "Ship To": [body.shipToId],
      "Delivery Date": body.deliveryDate || null,
      "Shipping Terms": body.shippingTerms || "",
      "Payment Terms": body.paymentTerms || "",
      Notes: body.notes || "",
      "Grand Total": body.grandTotal,
      Status: body.status || "Draft",
    });

    // Delete existing line items
    const existing = await getRecord(TABLES.PURCHASE_ORDERS, id);
    const existingLineItemIds =
      (existing.fields["PO Line Items"] as string[]) || [];
    for (const liId of existingLineItemIds) {
      await deleteRecord(TABLES.PO_LINE_ITEMS, liId);
    }

    // Recreate line items
    const poNumber = po.fields?.["PO Number"] || existing.fields["PO Number"];
    if (body.lineItems && body.lineItems.length > 0) {
      const lineItemRecords = body.lineItems.map(
        (item: {
          skuId: string;
          section: string;
          qtySticks: number;
          qtyCartons: number | null;
          unitCost: number;
          costBasis: string;
          totalPrice: number;
        }) => ({
          fields: {
            "Line Item ID": `${poNumber}-${item.skuId.slice(-6)}`,
            "Purchase Order": [id],
            SKU: [item.skuId],
            Section: item.section,
            "Qty Sticks": item.qtySticks,
            "Qty Cartons": item.qtyCartons,
            "Unit Cost": item.unitCost,
            "Cost Basis": item.costBasis,
            "Total Price": item.totalPrice,
          },
        })
      );
      await createRecords(TABLES.PO_LINE_ITEMS, lineItemRecords);
    }

    return NextResponse.json({ id, poNumber });
  } catch {
    return NextResponse.json(
      { error: "Failed to update PO" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get PO to find its line items
    const record = await getRecord(TABLES.PURCHASE_ORDERS, id);
    const lineItemIds = (record.fields["PO Line Items"] as string[]) || [];

    // Delete line items first
    for (const liId of lineItemIds) {
      await deleteRecord(TABLES.PO_LINE_ITEMS, liId);
    }

    // Delete the PO
    await deleteRecord(TABLES.PURCHASE_ORDERS, id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete PO" }, { status: 500 });
  }
}
