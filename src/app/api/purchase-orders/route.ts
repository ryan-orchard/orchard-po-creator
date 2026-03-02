import { NextRequest, NextResponse } from "next/server";
import {
  getRecords,
  createRecord,
  createRecords,
  TABLES,
} from "@/lib/airtable";

export async function GET() {
  const records = await getRecords(TABLES.PURCHASE_ORDERS, {
    sort: [{ field: "Date", direction: "desc" }],
  });

  const pos = records.map((r) => ({
    id: r.id,
    poNumber: r.fields["PO Number"] as string,
    date: r.fields["Date"] as string,
    status: r.fields["Status"] as string,
    supplier: r.fields["Supplier"] as string[],
    shipTo: r.fields["Ship To"] as string[],
    deliveryDate: r.fields["Delivery Date"] as string,
    shippingTerms: r.fields["Shipping Terms"] as string,
    paymentTerms: r.fields["Payment Terms"] as string,
    notes: r.fields["Notes"] as string,
    grandTotal: r.fields["Grand Total"] as number,
    lineItems: r.fields["PO Line Items"] as string[],
  }));

  return NextResponse.json(pos);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  // Generate PO number: MAGNA-PO-YYYY-###
  const year = new Date().getFullYear();
  const existingPOs = await getRecords(TABLES.PURCHASE_ORDERS, {
    filterByFormula: `SEARCH("MAGNA-PO-${year}", {PO Number})`,
  });
  const nextNum = existingPOs.length + 1;
  const poNumber = `MAGNA-PO-${year}-${String(nextNum).padStart(3, "0")}`;

  // Create PO header
  const po = await createRecord(TABLES.PURCHASE_ORDERS, {
    "PO Number": poNumber,
    Date: body.date,
    Status: "Draft",
    Supplier: [body.supplierId],
    "Ship To": [body.shipToId],
    "Delivery Date": body.deliveryDate || null,
    "Shipping Terms": body.shippingTerms || "",
    "Payment Terms": body.paymentTerms || "",
    Notes: body.notes || "",
    "Grand Total": body.grandTotal,
  });

  // Create line items
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
        shipToOverrideId?: string;
      }) => ({
        fields: {
          "Line Item ID": `${poNumber}-${item.skuId.slice(-6)}`,
          "Purchase Order": [po.id],
          SKU: [item.skuId],
          Section: item.section,
          "Qty Sticks": item.qtySticks,
          "Qty Cartons": item.qtyCartons,
          "Unit Cost": item.unitCost,
          "Cost Basis": item.costBasis,
          "Total Price": item.totalPrice,
          ...(item.shipToOverrideId
            ? { "Ship To Override": [item.shipToOverrideId] }
            : {}),
        },
      })
    );

    await createRecords(TABLES.PO_LINE_ITEMS, lineItemRecords);
  }

  return NextResponse.json({ id: po.id, poNumber });
}
