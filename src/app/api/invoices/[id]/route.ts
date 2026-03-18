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

    const skuMap = new Map<string, string>();

    if (lineIds?.length) {
      const lineRecords = await Promise.all(
        lineIds.map((lid) => getRecord(TABLES.INVOICE_LINES, lid))
      );

      // Fetch SKU names for mapped lines
      const skuIds = lineRecords
        .map((lr) => (lr.fields["SKU"] as string[])?.[0])
        .filter(Boolean) as string[];
      const uniqueSkuIds = [...new Set(skuIds)];
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

    // Fetch linked PO, receipt, and shipment data if invoice is matched
    const poLink = (f["Purchase Order"] as string[] | undefined)?.[0];
    let purchaseOrder: { id: string; poNumber: string; status: string } | null = null;
    let receipts: { id: string; receiptNumber: string; receivedDate: string; lines: { sku: string; qtyReceived: number }[] }[] = [];
    let shipments: { id: string; shipmentNumber: string; shipDate: string; status: string }[] = [];

    if (poLink) {
      const [po, allReceipts, allReceiptLines, allShipments, allItems] = await Promise.all([
        getRecord(TABLES.PURCHASE_ORDERS, poLink),
        getRecords(TABLES.RECEIPTS),
        getRecords(TABLES.RECEIPT_LINES),
        getRecords(TABLES.SHIPMENTS),
        getRecords(TABLES.SKUS),
      ]);

      // Populate skuMap with all items for receipt line resolution
      for (const item of allItems) {
        if (!skuMap.has(item.id)) {
          skuMap.set(item.id, (item.fields["Standard SKU"] as string) || (item.fields["Name"] as string) || item.id);
        }
      }

      purchaseOrder = {
        id: po.id,
        poNumber: (po.fields["PO Number"] as string) || "",
        status: (po.fields["Status"] as string) || "",
      };

      // Filter receipts linked to this PO
      const poReceipts = allReceipts.filter((r) => {
        const poIds = r.fields["Purchase Order"] as string[] | undefined;
        return poIds?.[0] === poLink;
      });
      const receiptIds = poReceipts.map((r) => r.id);

      // Build receipt data with their lines
      const receiptLinesByReceipt: Record<string, { sku: string; qtyReceived: number }[]> = {};
      for (const rl of allReceiptLines) {
        const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
        const receiptId = rlReceiptIds?.[0];
        if (receiptId && receiptIds.includes(receiptId)) {
          if (!receiptLinesByReceipt[receiptId]) receiptLinesByReceipt[receiptId] = [];
          const rlSkuIds = rl.fields["SKU"] as string[] | undefined;
          const rlSkuId = rlSkuIds?.[0];
          receiptLinesByReceipt[receiptId].push({
            sku: rlSkuId ? skuMap.get(rlSkuId) || rlSkuId : "Unknown",
            qtyReceived: (rl.fields["Qty Received"] as number) || 0,
          });
        }
      }

      receipts = poReceipts.map((r) => ({
        id: r.id,
        receiptNumber: (r.fields["Receipt Number"] as string) || "",
        receivedDate: (r.fields["Received Date"] as string) || "",
        lines: receiptLinesByReceipt[r.id] || [],
      }));

      // Filter shipments linked to this PO
      const poShipments = allShipments.filter((s) => {
        const poIds = s.fields["Purchase Order"] as string[] | undefined;
        return poIds?.[0] === poLink;
      });

      shipments = poShipments.map((s) => ({
        id: s.id,
        shipmentNumber: (s.fields["Shipment Number"] as string) || "",
        shipDate: (s.fields["Ship Date"] as string) || "",
        status: (s.fields["Status"] as string) || "",
      }));
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
      reviewStatus: (f["Review Status"] as string) || "Pending",
      paymentStatus: (f["Payment Status"] as string) || "Unpaid",
      notes: (f["Notes"] as string) || "",
      lines,
      purchaseOrder,
      receipts,
      shipments,
    });
  } catch (error) {
    console.error("Error fetching invoice:", error);
    return NextResponse.json(
      { error: "Failed to fetch invoice" },
      { status: 500 }
    );
  }
}
