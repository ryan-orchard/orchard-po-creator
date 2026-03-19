import { NextRequest, NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";
import { fetchAllAdjustments } from "@/lib/stord-api";

import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";
const SKU_MAPPING: Record<string, { standardSku: string; airtableId: string } | null> =
  skuMappingData as Record<string, { standardSku: string; airtableId: string } | null>;

interface NormalizedRow {
  adjustmentDate: Date;
  sku: string;
  reason: string;
  reasonType: string;
  inventoryCategory: string;
  adjustedQuantity: number;
  productName: string;
  facility: string;
  orderNumber: string;
  lotNumber: string;
}

export async function GET(request: NextRequest) {
  const apiKey = process.env.STORD_API_KEY;
  const orgId = process.env.STORD_ORG_ID;
  const networkId = process.env.STORD_NETWORK_ID;

  if (!apiKey) {
    return NextResponse.json({ error: "STORD_API_KEY not configured" }, { status: 500 });
  }
  if (!orgId || !networkId) {
    return NextResponse.json({ error: "STORD_ORG_ID or STORD_NETWORK_ID not configured" }, { status: 500 });
  }

  const searchParams = request.nextUrl.searchParams;
  const from = searchParams.get("from"); // e.g. "2024-01-01T00:00:00Z"
  const to = searchParams.get("to");

  const baseParams = new URLSearchParams();
  if (from) baseParams.set("adjusted_after", from);
  if (to) baseParams.set("adjusted_before", to);
  // Only fetch receipt-type rows — avoids paging through outbound/work order volume
  baseParams.append("reason_types[]", "Receipt");

  try {
    const adjustments = await fetchAllAdjustments(apiKey, orgId, networkId, baseParams);

    // Fetch items from Airtable (needed for SKU dropdown)
    const allItems = await getRecords(TABLES.SKUS);
    const availableItems = allItems
      .filter((item) => (item.fields["Status"] as string) !== "Inactive")
      .map((item) => ({
        id: item.id,
        standardSku: (item.fields["Standard SKU"] as string) || "",
        category: (item.fields["Category"] as string) || "",
      }))
      .sort((a, b) => a.standardSku.localeCompare(b.standardSku));

    if (adjustments.length === 0) {
      const label = buildLabel(from, to);
      return NextResponse.json({
        fileName: label,
        totalRows: 0,
        dateRange: { from: null, to: null },
        classification: {
          receiptConfirmation: 0,
          inboundInventory: 0,
          customerReturns: 0,
          workOrders: 0,
          outboundShipments: 0,
          outboundAllocations: 0,
          other: 0,
          total: 0,
        },
        receipts: [],
        availableItems,
      });
    }

    // Normalize to common row format.
    // API quantities are signed from the ledger perspective:
    //   Receipt Confirmation rows are NEGATIVE on "incoming" (goods leaving incoming bucket)
    //   Inbound Inventory rows are POSITIVE on "incoming" (goods entering incoming from ASN)
    // We take absolute value since we care about magnitude, not ledger direction.
    const rows: NormalizedRow[] = adjustments.map((adj) => ({
      adjustmentDate: new Date(adj.adjusted_at),
      sku: adj.sku || "",
      reason: adj.reason || "",
      reasonType: adj.reason_type || "",
      inventoryCategory: adj.category || "",
      adjustedQuantity: Math.abs(parseFloat(adj.adjustment_quantity) || 0),
      productName: adj.name || "",
      facility: adj.facility_alias || "",
      orderNumber: adj.order_number || "",
      lotNumber: adj.lot_number || "",
    }));

    // Classify rows
    const classification = {
      receiptConfirmation: 0,
      inboundInventory: 0,
      customerReturns: 0,
      workOrders: 0,
      outboundShipments: 0,
      outboundAllocations: 0,
      other: 0,
      total: rows.length,
    };

    const receiptRows: NormalizedRow[] = [];
    const inboundRows: NormalizedRow[] = [];

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

    // API doesn't triple-count like the CSV export — no category-based deduplication needed.
    // Each row is a distinct receipt event. Use all Receipt Confirmation rows.
    const rowsToProcess = receiptRows;

    // Group by Order Number
    const receiptGroups: Record<string, NormalizedRow[]> = {};
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

    // Build parsed receipts
    const parsedReceipts = [];

    for (const [orderNumber, orderRows] of Object.entries(receiptGroups)) {
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

      const lines = Object.entries(skuAgg).map(([stordSku, agg]) => {
        const mapping = SKU_MAPPING[stordSku];
        const expected = expectedByOrder[orderNumber]?.[stordSku] ?? null;

        return {
          stordSku,
          productName: agg.productName,
          qtyReceived: agg.qty,
          qtyExpected: expected,
          lotNumber: Array.from(agg.lotNumbers).join(", ") || null,
          standardSku: mapping?.standardSku || null,
          airtableSkuId: mapping?.airtableId || null,
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

    // Date range from the full row set
    let minDate: Date | null = null;
    let maxDate: Date | null = null;
    for (const row of rows) {
      const d = row.adjustmentDate;
      if (!isNaN(d.getTime())) {
        if (!minDate || d < minDate) minDate = d;
        if (!maxDate || d > maxDate) maxDate = d;
      }
    }

    return NextResponse.json({
      fileName: buildLabel(from, to),
      totalRows: rows.length,
      dateRange: {
        from: minDate?.toISOString().split("T")[0] ?? null,
        to: maxDate?.toISOString().split("T")[0] ?? null,
      },
      classification,
      receipts: parsedReceipts,
      availableItems,
    });
  } catch (error) {
    console.error("Stord sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stord sync failed" },
      { status: 500 }
    );
  }
}

function buildLabel(from: string | null, to: string | null): string {
  if (from && to) {
    const f = from.split("T")[0];
    const t = to.split("T")[0];
    return `Stord API (${f} – ${t})`;
  }
  if (from) return `Stord API (from ${from.split("T")[0]})`;
  if (to) return `Stord API (to ${to.split("T")[0]})`;
  return "Stord API";
}
