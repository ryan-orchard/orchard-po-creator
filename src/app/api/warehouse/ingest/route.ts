import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getRecords, TABLES } from "@/lib/airtable";

// Stord SKU -> Standard SKU mapping (loaded from config)
import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";
const SKU_MAPPING: Record<string, { standardSku: string; airtableId: string } | null> =
  skuMappingData as Record<string, { standardSku: string; airtableId: string } | null>;

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
}

interface ParsedReceipt {
  orderNumber: string;
  receivedDate: string;
  facility: string;
  lines: {
    stordSku: string;
    productName: string;
    qtyReceived: number;
    qtyExpected: number | null;
    lotNumber: string | null;
    standardSku: string | null;
    airtableSkuId: string | null;
    uom: string | null;
    skuMapped: boolean;
  }[];
  matchedPO: { id: string; poNumber: string } | null;
  poMatchAttempted: boolean;
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
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Parse XLSX or CSV
    const buffer = await file.arrayBuffer();
    const isCSV = file.name.toLowerCase().endsWith(".csv");
    const workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      ...(isCSV ? { raw: false } : {}),
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    if (rawRows.length < 2) {
      return NextResponse.json({ error: "File is empty or has no data rows" }, { status: 400 });
    }

    // Validate headers
    const headers = rawRows[0] as string[];
    const expectedHeaders = [
      "Adjustment Date", "SKU", "Reason", "Reason Type", "Inventory Category",
    ];
    const missingHeaders = expectedHeaders.filter(
      (h) => !headers.some((hdr) => hdr?.toLowerCase().trim() === h.toLowerCase())
    );
    if (missingHeaders.length > 0) {
      return NextResponse.json(
        { error: `Missing expected columns: ${missingHeaders.join(", ")}` },
        { status: 400 }
      );
    }

    // Parse rows
    const dataRows = rawRows.slice(1).filter((row) => row.length > 0 && row[0] != null);
    const rows: StordRow[] = dataRows.map((row) => ({
      adjustmentDate: row[0] instanceof Date ? row[0] : new Date(row[0] as string),
      sku: (row[1] as string) || "",
      reason: (row[2] as string) || "",
      reasonType: (row[3] as string) || "",
      inventoryCategory: (row[4] as string) || "",
      valueBeforeAdjustment: Number(row[5]) || 0,
      adjustedQuantity: Number(row[6]) || 0,
      valueAfterAdjustment: Number(row[7]) || 0,
      unit: (row[8] as string) || "",
      productName: (row[9] as string) || "",
      brand: (row[10] as string) || "",
      facility: (row[11] as string) || "",
      orderNumber: (row[12] as string) || "",
      lotNumber: (row[13] as string) || "",
      expiresAt: (row[14] as string) || "",
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
    const inboundRows: StordRow[] = [];

    for (const row of rows) {
      if (row.reason === "Receipt Confirmation" && row.reasonType === "Receipt") {
        classification.receiptConfirmation++;
        receiptRows.push(row);
      } else if (row.reason === "Inbound Inventory" && row.reasonType === "Receipt") {
        classification.inboundInventory++;
        inboundRows.push(row);
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
      const key = row.orderNumber || "UNKNOWN";
      if (!receiptGroups[key]) receiptGroups[key] = [];
      receiptGroups[key].push(row);
    }

    // Build expected quantities from inbound rows
    const expectedByOrder: Record<string, Record<string, number>> = {};
    for (const row of inboundRows) {
      const key = row.orderNumber || "UNKNOWN";
      if (!expectedByOrder[key]) expectedByOrder[key] = {};
      if (!expectedByOrder[key][row.sku]) expectedByOrder[key][row.sku] = 0;
      expectedByOrder[key][row.sku] += row.adjustedQuantity;
    }

    // Fetch existing POs, line items, and items (for UOM)
    const [existingPOs, poLineItems, allItems] = await Promise.all([
      getRecords(TABLES.PURCHASE_ORDERS, {
        sort: [{ field: "PO Number", direction: "desc" }],
      }),
      getRecords(TABLES.PO_LINE_ITEMS),
      getRecords(TABLES.SKUS),
    ]);

    // Build item UOM lookup: item record ID -> UOM
    const itemUOM: Record<string, string> = {};
    for (const item of allItems) {
      itemUOM[item.id] = (item.fields["UOM"] as string) || "Each";
    }

    // Build PO line items grouped by PO record ID
    const poLinesByPO: Record<string, { skuId: string; qtySticks: number; qtyCartons: number | null }[]> = {};
    for (const li of poLineItems) {
      const poLinks = li.fields["Purchase Order"] as string[] | undefined;
      const skuLinks = li.fields["SKU"] as string[] | undefined;
      if (!poLinks?.[0] || !skuLinks?.[0]) continue;
      const poId = poLinks[0];
      if (!poLinesByPO[poId]) poLinesByPO[poId] = [];
      poLinesByPO[poId].push({
        skuId: skuLinks[0],
        qtySticks: (li.fields["Qty Sticks"] as number) || 0,
        qtyCartons: (li.fields["Qty Cartons"] as number) || null,
      });
    }

    const poList = existingPOs
      .filter((r) => r.fields["Status"] === "Issued")
      .map((r) => ({
        id: r.id,
        poNumber: r.fields["PO Number"] as string,
        lineItems: poLinesByPO[r.id] || [],
      }));

    // Build parsed receipts
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
        const expected = expectedByOrder[orderNumber]?.[stordSku] || null;

        return {
          stordSku,
          productName: agg.productName,
          qtyReceived: agg.qty,
          qtyExpected: expected,
          lotNumber: Array.from(agg.lotNumbers).join(", ") || null,
          standardSku: mapping?.standardSku || null,
          airtableSkuId: mapping?.airtableId || null,
          uom: mapping?.airtableId ? (itemUOM[mapping.airtableId] || null) : null,
          skuMapped: mapping !== undefined,
        };
      });

      // Attempt PO matching
      const matchedPO = attemptPOMatch(orderNumber, poList);

      parsedReceipts.push({
        orderNumber,
        receivedDate: earliestDate ? earliestDate.toISOString().split("T")[0] : "",
        facility,
        lines,
        matchedPO,
        poMatchAttempted: true,
      });
    }

    // Get date range (avoid spread operator — large arrays overflow the call stack)
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    for (const row of rows) {
      const d = row.adjustmentDate;
      if (d instanceof Date && !isNaN(d.getTime())) {
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }
    }

    return NextResponse.json({
      fileName: file.name,
      totalRows: rows.length,
      dateRange: {
        from: minDate?.toISOString().split("T")[0] || null,
        to: maxDate?.toISOString().split("T")[0] || null,
      },
      classification,
      receipts: parsedReceipts,
      availablePOs: poList,
    });
  } catch (error) {
    console.error("Ingestion error:", error);
    return NextResponse.json(
      { error: `Failed to parse file: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}

function attemptPOMatch(
  orderNumber: string,
  poList: { id: string; poNumber: string }[]
): { id: string; poNumber: string } | null {
  if (!orderNumber) return null;

  // Try exact match first (e.g., "PO-10001")
  const exactMatch = poList.find(
    (po) => po.poNumber.toLowerCase() === orderNumber.toLowerCase()
  );
  if (exactMatch) return exactMatch;

  // Extract leading number from order number (e.g., "36 - Blue Ice" -> "36")
  const numMatch = orderNumber.match(/^(\d+)/);
  if (numMatch) {
    const num = numMatch[1];
    // Try matching PO-XXXXX format
    const poMatch = poList.find((po) => po.poNumber === `PO-${num}`);
    if (poMatch) return poMatch;
  }

  // Try extracting PO number from various formats
  // "ANS PO 27-4 Bulk Sticks..." -> try "PO-27"
  const ansPOMatch = orderNumber.match(/(?:ANS\s+)?PO\s+(\d+)/i);
  if (ansPOMatch) {
    const num = ansPOMatch[1];
    const poMatch = poList.find((po) => po.poNumber === `PO-${num}`);
    if (poMatch) return poMatch;
  }

  return null;
}
