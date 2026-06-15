import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { SKU_MAPPING } from "@/lib/client-config";
import { parseStordAdjustmentRows } from "@/lib/stord-adjustments-parser";

interface StordRow {
  adjustmentDate: Date;
  sku: string;
  reason: string;
  reasonType: string;
  inventoryCategory: string;
  valueBeforeAdjustment: number;
  adjustedQuantity: number;
  valueAfterAdjustment: number;
  unit: string;
  productName: string;
  brand: string;
  facility: string;
  orderNumber: string;
  lotNumber: string;
  expiresAt: string;
  notes: string;
}

interface ParsedReceipt {
  orderNumber: string;
  receivedDate: string;
  facility: string;
  lines: {
    stordSku: string;
    productName: string;
    qtyReceived: number;
    lotNumber: string | null;
    standardSku: string | null;
    itemId: string | null;
    skuMapped: boolean;
  }[];
}

interface ClassificationSummary {
  receiptConfirmation: number;
  inboundInventory: number;
  customerReturns: number;
  workOrders: number;
  outboundShipments: number;
  outboundAllocations: number;
  other: number;
  total: number;
}

export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Parse via the shared, header-name-based parser (resilient to Stord
    // renaming/reordering columns — same code path as the email auto-ingest).
    const buffer = Buffer.from(await file.arrayBuffer());
    let parsedRows;
    try {
      parsedRows = parseStordAdjustmentRows(buffer);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Unrecognized file format" },
        { status: 400 }
      );
    }

    if (parsedRows.length === 0) {
      return NextResponse.json({ error: "File is empty or has no data rows" }, { status: 400 });
    }

    const rows: StordRow[] = parsedRows.map((r) => ({
      adjustmentDate: new Date(r.adjustmentDate),
      sku: r.sku,
      reason: r.reason,
      reasonType: r.reasonType,
      inventoryCategory: r.inventoryCategory,
      valueBeforeAdjustment: r.valueBeforeAdjustment,
      adjustedQuantity: r.adjustedQuantity,
      valueAfterAdjustment: r.valueAfterAdjustment,
      unit: r.unit,
      productName: r.productName,
      brand: r.brand,
      facility: r.facility,
      orderNumber: r.orderNumber,
      lotNumber: r.lotNumber,
      expiresAt: r.expiresAt,
      notes: r.notes,
    }));

    // Classify rows
    const classification: ClassificationSummary = {
      receiptConfirmation: 0,
      inboundInventory: 0,
      customerReturns: 0,
      workOrders: 0,
      outboundShipments: 0,
      outboundAllocations: 0,
      other: 0,
      total: rows.length,
    };

    const receiptRows: StordRow[] = [];

    for (const row of rows) {
      if (row.reason === "Receipt Confirmation" && row.reasonType === "Receipt") {
        classification.receiptConfirmation++;
        receiptRows.push(row);
      } else if (row.reason === "Inbound Inventory" && row.reasonType === "Receipt") {
        classification.inboundInventory++;
      } else if (row.reason === "Customer Returned Inventory") {
        classification.customerReturns++;
      } else if (row.reason === "Work Order Inventory Adjustment") {
        classification.workOrders++;
      } else if (row.reason === "Shipment Confirmation") {
        classification.outboundShipments++;
      } else if (row.reason === "Outbound Inventory") {
        classification.outboundAllocations++;
      } else {
        classification.other++;
      }
    }

    // Process receipts: filter to Receiving category, aggregate by order + SKU
    const receivingRows = receiptRows.filter((r) => r.inventoryCategory === "Receiving");
    // Fallback to Locked if no Receiving rows
    const rowsToProcess = receivingRows.length > 0
      ? receivingRows
      : receiptRows.filter((r) => r.inventoryCategory === "Locked");

    // Group by Order Number -> aggregate by SKU
    const receiptGroups: Record<string, StordRow[]> = {};
    for (const row of rowsToProcess) {
      const key = row.orderNumber || row.notes || "UNKNOWN";
      if (!receiptGroups[key]) receiptGroups[key] = [];
      receiptGroups[key].push(row);
    }

    // Fetch items from Supabase for SKU mapping and available items dropdown
    const { data: itemRows } = await db
      .schema("org_config")
      .from("items")
      .select("id, sku, accounting_category, is_active")
      .eq("is_active", true);
    const allItems = itemRows ?? [];
    const itemIdBySku = new Map(allItems.map((i) => [i.sku as string, i.id as string]));

    // Build parsed receipts — no PO matching
    const parsedReceipts: ParsedReceipt[] = [];

    for (const [orderNumber, orderRows] of Object.entries(receiptGroups)) {
      // Aggregate by SKU
      const skuAgg: Record<string, { qty: number; lotNumbers: Set<string>; productName: string }> = {};
      let earliestDate: Date | null = null;
      let facility = "";

      for (const row of orderRows) {
        if (!skuAgg[row.sku]) {
          skuAgg[row.sku] = { qty: 0, lotNumbers: new Set(), productName: row.productName };
        }
        skuAgg[row.sku].qty += row.adjustedQuantity;
        if (row.lotNumber) skuAgg[row.sku].lotNumbers.add(row.lotNumber);
        if (!earliestDate || row.adjustmentDate < earliestDate) {
          earliestDate = row.adjustmentDate;
        }
        if (!facility) facility = row.facility;
      }

      // Map SKUs and build lines
      const lines = Object.entries(skuAgg).map(([stordSku, agg]) => {
        const mapping = SKU_MAPPING[stordSku];

        const standardSku = mapping?.standardSku || null;
        return {
          stordSku,
          productName: agg.productName,
          qtyReceived: agg.qty,
          lotNumber: Array.from(agg.lotNumbers).join(", ") || null,
          standardSku,
          itemId: standardSku ? (itemIdBySku.get(standardSku) ?? null) : null,
          skuMapped: mapping !== undefined,
        };
      });

      parsedReceipts.push({
        orderNumber,
        receivedDate: earliestDate ? earliestDate.toISOString().split("T")[0] : "",
        facility,
        lines,
      });
    }

    // Get date range
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    for (const row of rows) {
      const d = row.adjustmentDate;
      if (d instanceof Date && !isNaN(d.getTime())) {
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }
    }

    // Build items list for SKU mapping dropdown
    const availableItems = allItems
      .map((item) => ({
        id: item.id as string,
        standardSku: (item.sku as string) || "",
        category: (item.accounting_category as string) || "",
      }))
      .sort((a, b) => a.standardSku.localeCompare(b.standardSku));

    return NextResponse.json({
      fileName: file.name,
      totalRows: rows.length,
      dateRange: {
        from: minDate?.toISOString().split("T")[0] || null,
        to: maxDate?.toISOString().split("T")[0] || null,
      },
      classification,
      receipts: parsedReceipts,
      availableItems,
    });
  } catch (error) {
    console.error("Ingestion error:", error);
    return NextResponse.json(
      { error: `Failed to parse file: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
