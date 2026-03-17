import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, TABLES } from "@/lib/airtable";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = await getRecord(TABLES.INVOICES, id);

    if (!record || !record.fields) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const f = record.fields;

    // Fetch supplier name if linked
    let supplierName = "";
    const supplierIds = f["Supplier"] as string[] | undefined;
    if (supplierIds?.length) {
      const supplier = await getRecord(TABLES.SUPPLIERS, supplierIds[0]);
      supplierName = (supplier.fields["Supplier Name"] as string) || "";
    }

    // Fetch invoice line items
    const lineIds = f["Invoice Lines"] as string[] | undefined;
    let lines: {
      id: string;
      lineId: string;
      ansItemNumber: string;
      description: string;
      skuName: string | null;
      qtyBilled: number;
      unitCost: number;
      unit: string;
      amount: number;
      batchNumber: string;
    }[] = [];

    if (lineIds?.length) {
      const lineRecords = await Promise.all(
        lineIds.map((lid) => getRecord(TABLES.INVOICE_LINES, lid))
      );

      // Fetch SKU names for mapped lines
      const skuIds = lineRecords
        .map((lr) => (lr.fields["SKU"] as string[])?.[0])
        .filter(Boolean) as string[];
      const uniqueSkuIds = [...new Set(skuIds)];
      const skuMap = new Map<string, string>();
      if (uniqueSkuIds.length) {
        const skuRecords = await Promise.all(
          uniqueSkuIds.map((sid) => getRecord(TABLES.SKUS, sid))
        );
        skuRecords.forEach((sr) => {
          skuMap.set(sr.id, (sr.fields["Standard SKU"] as string) || "");
        });
      }

      lines = lineRecords.map((lr) => {
        const lf = lr.fields;
        const skuId = (lf["SKU"] as string[])?.[0];
        return {
          id: lr.id,
          lineId: (lf["Line ID"] as string) || "",
          ansItemNumber: (lf["ANS Item Number"] as string) || "",
          description: (lf["Description"] as string) || "",
          skuName: skuId ? skuMap.get(skuId) || null : null,
          qtyBilled: (lf["Qty Billed"] as number) || 0,
          unitCost: (lf["Unit Cost"] as number) || 0,
          unit: (lf["Unit"] as string) || "EA",
          amount: (lf["Amount"] as number) || 0,
          batchNumber: (lf["Batch Number"] as string) || "",
        };
      });
    }

    return NextResponse.json({
      id: record.id,
      invoiceNumber: (f["Invoice Number"] as string) || "",
      invoiceDate: (f["Invoice Date"] as string) || "",
      supplier: supplierName,
      salesOrder: (f["Sales Order"] as string) || "",
      poReference: (f["PO Reference"] as string) || "",
      paymentTerms: (f["Payment Terms"] as string) || "",
      trackingNumber: (f["Tracking Number"] as string) || "",
      deliveryTerms: (f["Delivery Terms"] as string) || "",
      shipTo: (f["Ship To"] as string) || "",
      subtotal: (f["Subtotal"] as number) || 0,
      freight: (f["Freight"] as number) || 0,
      tax: (f["Tax"] as number) || 0,
      invoiceAmount: (f["Total Amount"] as number) || 0,
      status: (f["Status"] as string) || "Pending",
      notes: (f["Notes"] as string) || "",
      lines,
    });
  } catch (error) {
    console.error("Error fetching invoice:", error);
    return NextResponse.json(
      { error: "Failed to fetch invoice" },
      { status: 500 }
    );
  }
}
