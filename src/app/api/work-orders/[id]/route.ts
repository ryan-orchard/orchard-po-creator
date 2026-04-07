import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import {
  getRecord,
  getRecords,
  updateRecord,
  deleteRecord,
  deleteRecords,
  createRecords,
  fetchInBatches,
  TABLES,
} from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const record = await getRecord(TABLES.WORK_ORDERS, id);

    if (!record || !record.id) {
      return NextResponse.json({ error: "Work Order not found" }, { status: 404 });
    }

    // Fetch warehouse and all SKUs in parallel
    const warehouseIds = (record.fields["Location"] as string[]) || [];

    const [warehouse, allSkus] = await Promise.all([
      warehouseIds[0] ? getRecord(TABLES.WAREHOUSES, warehouseIds[0]) : null,
      getRecords(TABLES.SKUS),
    ]);

    // Build SKU lookup map
    const skuMap = new Map(allSkus.map((s) => [s.id, s]));

    // Fetch line items in batches
    const lineItemIds = (record.fields["Work Order Lines"] as string[]) || [];
    const lineItems = await fetchInBatches(lineItemIds, (liId) =>
      getRecord(TABLES.WORK_ORDER_LINES, liId)
    );

    // Map line items with SKU data
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
              count: sku.fields["Sticks per Carton"] as number | null,
              uom: sku.fields["UOM"] as string,
              category: sku.fields["Category"] as string,
            }
          : null,
        lineType: li.fields["Line Type"] as string,
        qty: li.fields["Quantity"] as number,
      };
    });

    // Separate into inputs and outputs
    const inputs = lineItemsWithSkus.filter((li) => li.lineType === "Input");
    const outputs = lineItemsWithSkus.filter((li) => li.lineType === "Output");

    // Fetch linked shipments, receipts, invoices
    const shipmentIds = (record.fields["Shipments"] as string[]) || [];
    const receiptIds = (record.fields["Receipts"] as string[]) || [];
    const invoiceIds = (record.fields["Invoices"] as string[]) || [];

    const [shipments, receipts, invoices] = await Promise.all([
      fetchInBatches(shipmentIds, async (sId) => {
        const s = await getRecord(TABLES.SHIPMENTS, sId);
        return {
          id: s.id,
          shipmentNumber: s.fields["Shipment Number"] as string,
          shipDate: (s.fields["Ship Date"] as string) || null,
          status: (s.fields["Status"] as string) || null,
        };
      }),
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

    return NextResponse.json({
      id: record.id,
      woNumber: record.fields["WO Number"] as string,
      description: record.fields["Notes"] as string,
      status: record.fields["Status"] as string,
      issuedDate: record.fields["Issue Date"] as string,
      completedDate: record.fields["Completion Date"] as string,
      warehouseId: warehouseIds[0] || null,
      warehouse: warehouse
        ? {
            id: warehouse.id,
            name: warehouse.fields["Name"] as string,
            code: warehouse.fields["Code"] as string,
          }
        : null,
      inputs,
      outputs,
      lineItems: lineItemsWithSkus,
      shipments,
      receipts,
      invoices,
    });
  } catch (error) {
    console.error("WO detail fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Work Order" },
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
    const existing = await getRecord(TABLES.WORK_ORDERS, id);
    const woNumber = existing.fields["WO Number"] as string;

    // Update WO header
    await updateRecord(TABLES.WORK_ORDERS, id, {
      Notes: body.description || "",
      Location: [body.warehouseId],
      "Issue Date": body.issuedDate || null,
    });

    // Delete existing line items
    const existingLineItemIds =
      (existing.fields["Work Order Lines"] as string[]) || [];
    if (existingLineItemIds.length > 0) {
      await deleteRecords(TABLES.WORK_ORDER_LINES, existingLineItemIds);
    }

    // Recreate line items
    if (body.lineItems && body.lineItems.length > 0) {
      const lineItemRecords = body.lineItems.map(
        (item: {
          skuId: string;
          lineType: "Input" | "Output";
          qty: number;
        }) => ({
          fields: {
            "Work Order": [id],
            SKU: [item.skuId],
            "Line Type": item.lineType,
            Quantity: item.qty,
          },
        })
      );
      await createRecords(TABLES.WORK_ORDER_LINES, lineItemRecords);
    }

    logActivity({
      woId: id,
      action: "wo_edited",
      description: `Edited ${woNumber}`,
      actor: "Ryan Belanger",
      relatedRecordType: "work_order",
      relatedRecordId: id,
    });

    return NextResponse.json({ id, woNumber });
  } catch {
    return NextResponse.json(
      { error: "Failed to update Work Order" },
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
    const record = await getRecord(TABLES.WORK_ORDERS, id);
    const lineItemIds = (record.fields["Work Order Lines"] as string[]) || [];

    // Delete line items first
    if (lineItemIds.length > 0) {
      await deleteRecords(TABLES.WORK_ORDER_LINES, lineItemIds);
    }

    // Delete the WO
    await deleteRecord(TABLES.WORK_ORDERS, id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete Work Order" }, { status: 500 });
  }
}
