import { db } from "./supabase";
import { generateNextNumber } from "./sequence";
import { SKU_MAPPING, resolveFacilityCode } from "./client-config";
import type {
  StordAdjustmentRow,
  StordAdjustmentsReport,
} from "./stord-adjustments-parser";

interface ProcessResult {
  newReceipts: number;
  skippedExisting: number;
  totalReceiptRows: number;
}

export async function processStordAdjustmentsReport(
  report: StordAdjustmentsReport
): Promise<ProcessResult> {
  const receiptRows = report.rows.filter(
    (r) =>
      r.reason === "Receipt Confirmation" &&
      r.reasonType === "Receipt" &&
      r.inventoryCategory === "Receiving"
  );

  if (receiptRows.length === 0) {
    return { newReceipts: 0, skippedExisting: 0, totalReceiptRows: 0 };
  }

  // Group by order number
  const groups: Record<string, StordAdjustmentRow[]> = {};
  for (const row of receiptRows) {
    const key = row.orderNumber || "UNKNOWN";
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const orderNumbers = Object.keys(groups);

  // Check which order numbers already exist in bronze
  const { data: existing } = await db
    .schema("orchard")
    .from("receipts")
    .select("external_id")
    .in("external_id", orderNumbers);

  const existingSet = new Set(
    (existing ?? []).map((r) => r.external_id as string)
  );

  // Resolve location IDs for facilities
  const facilities = [
    ...new Set(receiptRows.map((r) => resolveFacilityCode(r.facility))),
  ];
  const { data: locations } = await db
    .schema("org_config")
    .from("locations")
    .select("id, code")
    .in("code", facilities);

  const locationMap = new Map(
    (locations ?? []).map((l) => [l.code as string, l.id as string])
  );

  // Resolve item IDs for SKU mapping
  const standardSkus = [
    ...new Set(
      receiptRows
        .map((r) => SKU_MAPPING[r.sku]?.standardSku)
        .filter((s): s is string => !!s)
    ),
  ];
  const { data: items } = await db
    .schema("org_config")
    .from("items")
    .select("id, sku")
    .in("sku", standardSkus.length > 0 ? standardSkus : ["__none__"]);

  const itemMap = new Map(
    (items ?? []).map((i) => [i.sku as string, i.id as string])
  );

  let newReceipts = 0;
  let skippedExisting = 0;

  for (const [orderNumber, orderRows] of Object.entries(groups)) {
    if (existingSet.has(orderNumber)) {
      skippedExisting++;
      continue;
    }

    // Find earliest date for receipt header
    let earliestDate = orderRows[0].adjustmentDate;
    for (const row of orderRows) {
      if (row.adjustmentDate < earliestDate) earliestDate = row.adjustmentDate;
    }

    const facilityCode = resolveFacilityCode(orderRows[0].facility);
    const locationId = locationMap.get(facilityCode) ?? null;
    const receiptNumber = await generateNextNumber("RCP");

    // Aggregate by SKU + lot number
    const lineAgg: Record<
      string,
      { qty: number; stordSku: string; lotNumber: string }
    > = {};
    for (const row of orderRows) {
      const key = `${row.sku}||${row.lotNumber}`;
      if (!lineAgg[key]) {
        lineAgg[key] = {
          qty: 0,
          stordSku: row.sku,
          lotNumber: row.lotNumber,
        };
      }
      lineAgg[key].qty += row.adjustedQuantity;
    }

    const { data: receipt, error: receiptError } = await db
      .schema("orchard")
      .from("receipts")
      .insert({
        receipt_number: receiptNumber,
        received_date: earliestDate.slice(0, 10),
        location_id: locationId,
        source: "Stord Adjustments Report",
        external_id: orderNumber,
        notes: null,
        po_id: null,
      })
      .select("id")
      .single();

    if (receiptError || !receipt) {
      console.error(
        `Failed to create receipt for ${orderNumber}:`,
        receiptError
      );
      continue;
    }

    const lineRows = Object.values(lineAgg).map((agg) => {
      const mapping = SKU_MAPPING[agg.stordSku];
      const itemId = mapping?.standardSku
        ? itemMap.get(mapping.standardSku) ?? null
        : null;

      return {
        receipt_id: receipt.id,
        item_id: itemId,
        qty_received: agg.qty,
        three_pl_sku: agg.stordSku,
        lot_number: agg.lotNumber || null,
        status: "Open",
      };
    });

    const { error: lineError } = await db
      .schema("orchard")
      .from("receipt_lines")
      .insert(lineRows);

    if (lineError) {
      console.error(
        `Failed to create receipt lines for ${orderNumber}:`,
        lineError
      );
    }

    newReceipts++;
  }

  console.log(
    `Stord adjustments ingest: ${newReceipts} new receipts, ${skippedExisting} skipped (existing), ${receiptRows.length} total rows`
  );

  return {
    newReceipts,
    skippedExisting,
    totalReceiptRows: receiptRows.length,
  };
}
