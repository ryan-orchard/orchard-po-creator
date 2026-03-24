import { NextResponse } from "next/server";
import { getRecords, createRecord, createRecords, TABLES } from "@/lib/airtable";
import { getMaxSequenceNumber } from "@/lib/sequence";
import { SKU_MAPPING, resolveFacilityCode } from "@/lib/client-config";
import { fetchAllAdjustments } from "@/lib/stord-api";
import { attemptPOMatch } from "@/lib/po-matching";
import { logActivity } from "@/lib/activity-log";

export async function POST() {
  const apiKey = process.env.STORD_API_KEY;
  const orgId = process.env.STORD_ORG_ID;
  const networkId = process.env.STORD_NETWORK_ID;

  if (!apiKey || !orgId || !networkId) {
    return NextResponse.json(
      { error: "Stord API credentials not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch last 30 days of receipt adjustments from Stord
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const baseParams = new URLSearchParams();
    baseParams.set("adjusted_after", from.toISOString());
    baseParams.set("adjusted_before", to.toISOString());
    baseParams.append("reason_types[]", "Receipt");

    const adjustments = await fetchAllAdjustments(apiKey, orgId, networkId, baseParams);

    // Filter to Receipt Confirmation rows and normalize
    const receiptRows = adjustments
      .filter((adj) => adj.reason === "Receipt Confirmation" && adj.reason_type === "Receipt")
      .map((adj) => ({
        adjustmentDate: new Date(adj.adjusted_at),
        sku: adj.sku || "",
        adjustedQuantity: Math.abs(parseFloat(adj.adjustment_quantity) || 0),
        productName: adj.name || "",
        facility: adj.facility_alias || "",
        orderNumber: adj.order_number || "",
        lotNumber: adj.lot_number || "",
      }));

    // Group by order number
    const receiptGroups: Record<string, typeof receiptRows> = {};
    for (const row of receiptRows) {
      const key = row.orderNumber || "UNKNOWN";
      if (!receiptGroups[key]) receiptGroups[key] = [];
      receiptGroups[key].push(row);
    }

    // Fetch existing receipts for dedup + receipt number generation (single query)
    const existingReceipts = await getRecords(TABLES.RECEIPTS);

    // Build dedup sets:
    // 1. External Receipt IDs (catches data-ingestion-created receipts that use order number)
    const existingExternalIds = new Set(
      existingReceipts
        .map((r) => r.fields["External Receipt ID"] as string)
        .filter(Boolean)
    );
    // 2. Order numbers from Notes field (catches webhook-created receipts that store
    //    the UUID as External Receipt ID and order number in Notes as "Order: ...")
    const existingOrderNumbers = new Set<string>();
    for (const r of existingReceipts) {
      const notes = r.fields["Notes"] as string;
      if (notes) {
        const match = notes.match(/^Order:\s*(.+?)(?:\s*\||$)/);
        if (match) existingOrderNumbers.add(match[1].trim());
      }
    }

    // Find max receipt number
    let maxNum = getMaxSequenceNumber(existingReceipts, "Receipt Number", "RCP");

    // Look up Stord warehouse
    const warehouses = await getRecords(TABLES.WAREHOUSES, {
      filterByFormula: `{Code} = "STORD"`,
    });
    const warehouseId = warehouses[0]?.id ?? null;

    // Fetch POs for activity logging
    const allPOs = await getRecords(TABLES.PURCHASE_ORDERS);
    const poList = allPOs.map((p) => ({
      id: p.id,
      poNumber: (p.fields["PO Number"] as string) || "",
    }));

    let created = 0;
    let skipped = 0;
    const totalCandidates = Object.keys(receiptGroups).length;

    for (const [orderNumber, orderRows] of Object.entries(receiptGroups)) {
      // Dedup: skip if this order number already exists
      if (existingExternalIds.has(orderNumber) || existingOrderNumbers.has(orderNumber)) {
        skipped++;
        continue;
      }

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

      // Generate receipt number
      maxNum++;
      const receiptNumber = `RCP-${maxNum}`;

      // Create receipt header
      const facilityCode = resolveFacilityCode(facility);
      const receiptFields: Record<string, unknown> = {
        "Receipt Number": receiptNumber,
        "Received Date": earliestDate ? earliestDate.toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        "External Receipt ID": orderNumber,
        ...(warehouseId && facilityCode === "STORD" ? { Warehouses: [warehouseId] } : {}),
      };

      const receipt = await createRecord(TABLES.RECEIPTS, receiptFields);

      // Create line items
      const lineItems = Object.entries(skuAgg).map(([stordSku, agg], index) => {
        const mapping = SKU_MAPPING[stordSku];
        return {
          fields: {
            "Line ID": `${receiptNumber}-${index + 1}`,
            Receipt: [receipt.id],
            ...(mapping?.airtableId ? { SKU: [mapping.airtableId] } : {}),
            "Qty Received": agg.qty,
            "3PL SKU": stordSku,
            ...(agg.lotNumbers.size > 0
              ? { "Lot Number": Array.from(agg.lotNumbers).join(", ") }
              : {}),
          },
        };
      });

      if (lineItems.length > 0) {
        await createRecords(TABLES.RECEIPT_LINES, lineItems);
      }

      // Log activity if we can match to a PO
      const matchedPO = attemptPOMatch(orderNumber, poList);
      if (matchedPO) {
        const totalQty = Object.values(skuAgg).reduce((sum, agg) => sum + agg.qty, 0);
        logActivity({
          poId: matchedPO.id,
          action: "receipt_created",
          description: `Receipt ${receiptNumber} synced from Stord — ${totalQty} units`,
          actor: "Ryan Belanger",
          relatedRecordType: "receipt",
          relatedRecordId: receipt.id,
        });
      }

      created++;
    }

    return NextResponse.json({
      created,
      skipped,
      total: totalCandidates,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Receipt sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Receipt sync failed" },
      { status: 500 }
    );
  }
}
