import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import {
  getRecord,
  getRecords,
  updateRecord,
  deleteRecord,
  createRecords,
  fetchInBatches,
  TABLES,
} from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";
import { computeLineTotal, deriveCostBasis, deriveSection } from "@/lib/po-calc";

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

    // Fetch supplier, ship-to, and all SKUs in parallel (SKUs as bulk query)
    const supplierIds = (record.fields["Supplier"] as string[]) || [];
    const shipToIds = (record.fields["Ship To"] as string[]) || [];

    const [supplier, shipTo, allSkus] = await Promise.all([
      supplierIds[0] ? getRecord(TABLES.SUPPLIERS, supplierIds[0]) : null,
      shipToIds[0] ? getRecord(TABLES.SHIP_TO, shipToIds[0]) : null,
      getRecords(TABLES.SKUS),
    ]);

    // Build SKU lookup map
    const skuMap = new Map(allSkus.map((s) => [s.id, s]));

    // Fetch line items in batches (29 items → 6 batches of 5)
    const lineItemIds = (record.fields["PO Line Items"] as string[]) || [];
    const lineItems = await fetchInBatches(lineItemIds, (liId) =>
      getRecord(TABLES.PO_LINE_ITEMS, liId)
    );

    // Map line items with SKUs from the pre-fetched map (no extra API calls)
    const lineItemsWithSkus = lineItems.map((li) => {
      const skuIds = (li.fields["SKU"] as string[]) || [];
      const sku = skuIds[0] ? skuMap.get(skuIds[0]) : null;
      return {
        id: li.id,
        skuId: skuIds[0] || null,
        sku: sku
          ? {
              standardSku: sku.fields["Standard SKU"] as string,
              flavor: sku.fields["Flavor"] as string,
              count: sku.fields["Sticks per Carton"] as number,
              uom: sku.fields["UOM"] as string,
              category: sku.fields["Category"] as string,
              supplierItemName: sku.fields["Supplier Item Name"] as string,
            }
          : null,
        section: li.fields["Section"] as string,
        qtySticks: li.fields["Qty Sticks"] as number,
        qtyCartons: li.fields["Qty Cartons"] as number,
        unitCost: li.fields["Unit Cost"] as number,
        costBasis: li.fields["Cost Basis"] as string,
        totalPrice: li.fields["Total Price"] as number,
      };
    });

    // Fetch linked receipts and invoices in batches
    const receiptIds = (record.fields["Receipts"] as string[]) || [];
    const invoiceIds = (record.fields["Invoices"] as string[]) || [];

    const [receipts, invoices] = await Promise.all([
      fetchInBatches(receiptIds, async (rId) => {
        const r = await getRecord(TABLES.RECEIPTS, rId);
        return {
          id: r.id,
          receiptNumber: r.fields["Receipt Number"] as string,
          receivedDate: (r.fields["Received Date"] as string) || null,
          warehouse: ((r.fields["Code (from Warehouses)"] as string[]) || [])[0] || null,
        };
      }),
      fetchInBatches(invoiceIds, async (iId) => {
        const inv = await getRecord(TABLES.INVOICES, iId);
        return {
          id: inv.id,
          invoiceNumber: inv.fields["Invoice Number"] as string,
          invoiceDate: (inv.fields["Invoice Date"] as string) || null,
          matchStatus: (inv.fields["Status"] as string) || null,
          totalAmount: (inv.fields["Total Amount"] as number) || null,
        };
      }),
    ]);

    // Always compute grand total from line items (single source of truth)
    const computedGrandTotal = lineItemsWithSkus.reduce(
      (sum, li) => sum + (li.totalPrice || 0),
      0
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
      soNumber: (record.fields["ANS SO Number"] as string) || null,
      grandTotal: computedGrandTotal,
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
      receipts: receipts,
      invoices: invoices,
    });
  } catch (error) {
    console.error("PO detail fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load PO" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  {
 params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  const { id } = await params;
  const body = await request.json();

  try {
    // Compute line item totals server-side (don't trust frontend)
    const lineItems = (body.lineItems || []).map(
      (item: {
        skuId: string;
        uom: string;
        count: number | null;
        qtySticks: number;
        qtyCartons: number | null;
        unitCost: number;
        totalPrice: number;
      }) => {
        const totalPrice = computeLineTotal(item.uom, item.qtySticks, item.qtyCartons, item.unitCost);
        return { ...item, totalPrice };
      }
    );

    const grandTotal = lineItems.reduce((sum: number, li: { totalPrice: number }) => sum + li.totalPrice, 0);

    // Update PO header
    const po = await updateRecord(TABLES.PURCHASE_ORDERS, id, {
      Date: body.date,
      Supplier: [body.supplierId],
      "Ship To": [body.shipToId],
      "Delivery Date": body.deliveryDate || null,
      "Shipping Terms": body.shippingTerms || "",
      "Payment Terms": body.paymentTerms || "",
      Notes: body.notes || "",
      "Grand Total": grandTotal,
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
    if (lineItems.length > 0) {
      const lineItemRecords = lineItems.map(
        (item: {
          skuId: string;
          uom: string;
          count: number | null;
          qtySticks: number;
          qtyCartons: number | null;
          unitCost: number;
          totalPrice: number;
        }) => ({
          fields: {
            "Line Item ID": `${poNumber}-${item.skuId.slice(-6)}`,
            "Purchase Order": [id],
            SKU: [item.skuId],
            Section: deriveSection(item.uom, item.count),
            "Qty Sticks": item.qtySticks,
            "Qty Cartons": item.qtyCartons,
            "Unit Cost": item.unitCost,
            "Cost Basis": deriveCostBasis(item.uom),
            "Total Price": item.totalPrice,
          },
        })
      );
      await createRecords(TABLES.PO_LINE_ITEMS, lineItemRecords);
    }

    logActivity({
      poId: id,
      action: "po_edited",
      description: `Edited ${poNumber}`,
      actor: "Ryan Belanger",
      relatedRecordType: "po",
      relatedRecordId: id,
    });

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
  {
 params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
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
