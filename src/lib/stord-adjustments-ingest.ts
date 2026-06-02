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
  failedOrders: { orderNumber: string; error: string }[];
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
    return { newReceipts: 0, skippedExisting: 0, totalReceiptRows: 0, failedOrders: [] };
  }

  // Group by order number
  const groups: Record<string, StordAdjustmentRow[]> = {};
  for (const row of receiptRows) {
    const key = row.orderNumber || "UNKNOWN";
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  const orderNumbers = Object.keys(groups);

  // Dedup by (external_id, received_date) — Stord reuses order numbers across
  // multiple inbound events on different dates. Deduping by order number alone
  // would silently skip subsequent shipments under the same order.
  const { data: existing } = await db
    .schema("orchard")
    .from("receipts")
    .select("external_id, received_date")
    .in("external_id", orderNumbers);

  // Key: "external_id::received_date"
  const existingSet = new Set(
    (existing ?? []).map((r) => `${r.external_id as string}::${r.received_date as string}`)
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
  const failedOrders: { orderNumber: string; error: string }[] = [];

  for (const [orderNumber, orderRows] of Object.entries(groups)) {
    try {

    // Find earliest date for receipt header
    let earliestDate = orderRows[0].adjustmentDate;
    for (const row of orderRows) {
      if (row.adjustmentDate < earliestDate) earliestDate = row.adjustmentDate;
    }
    const receiptDate = earliestDate.slice(0, 10);

    if (existingSet.has(`${orderNumber}::${receiptDate}`)) {
      skippedExisting++;
      continue;
    }

    const facilityCode = resolveFacilityCode(orderRows[0].facility);
    const locationId = locationMap.get(facilityCode) ?? null;
    const receiptNumber = await generateNextNumber("RCP");
    // receiptDate already computed above for dedup check

    // Aggregate by SKU + lot number.
    // Only count positive adjustments — negative rows under "Receipt Confirmation"
    // are Stord's internal lot/location corrections, not physical returns.
    const lineAgg: Record<
      string,
      { qty: number; stordSku: string; lotNumber: string }
    > = {};
    for (const row of orderRows) {
      if (row.adjustedQuantity <= 0) continue;
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

    const positiveLines = Object.values(lineAgg).filter((agg) => agg.qty > 0);
    if (positiveLines.length === 0) {
      console.log(`Skipping "${orderNumber}" — all lines net to zero after correction rows excluded`);
      continue;
    }

    const { data: receipt, error: receiptError } = await db
      .schema("orchard")
      .from("receipts")
      .insert({
        receipt_number: receiptNumber,
        received_date: receiptDate,
        location_id: locationId,
        source: "Stord",
        external_id: orderNumber,
        notes: null,
        po_id: null,
      })
      .select("id")
      .single();

    if (receiptError || !receipt) {
      const msg = receiptError?.message ?? "unknown error";
      console.error(`Failed to create receipt for ${orderNumber}: ${msg}`);
      failedOrders.push({ orderNumber, error: `receipt insert: ${msg}` });
      continue;
    }

    const lineRows = positiveLines.map((agg) => {
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
      console.error(`Failed to create receipt lines for ${orderNumber}: ${lineError.message}`);
      failedOrders.push({ orderNumber, error: `lines insert: ${lineError.message}` });
    }

    // Silver promotion handled by database trigger on orchard.receipt_lines

    newReceipts++;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Unexpected error processing order "${orderNumber}": ${msg}`);
      failedOrders.push({ orderNumber, error: `unexpected: ${msg}` });
    }
  }

  console.log(
    `Stord adjustments ingest: ${newReceipts} new, ${skippedExisting} skipped (existing), ${failedOrders.length} failed, ${receiptRows.length} total rows`
  );
  if (failedOrders.length > 0) {
    console.error(`Failed orders: ${JSON.stringify(failedOrders)}`);
  }

  return {
    newReceipts,
    skippedExisting,
    totalReceiptRows: receiptRows.length,
    failedOrders,
  };
}
