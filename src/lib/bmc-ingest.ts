/**
 * BMC Report Ingestion — writes parsed BMC report data to Supabase.
 *
 * - Inventory snapshots: upsert (replace per warehouse+date+item)
 * - Transactions: insert with ON CONFLICT skip (idempotent via entry_no)
 *
 * Silver receipt_lines are populated by a Postgres trigger on
 * orchard.bmc_transactions (mig 021). Purchase entries flow to silver
 * via UPSERT-with-sum on the aggregation grain. This file never writes
 * to orchard_calcs directly.
 */
import { db } from "./supabase";
import type { BmcReportResult } from "./bmc-parser";

interface ProcessResult {
  snapshotRows: number;
  newTransactions: number;
  skippedDuplicates: number;
}

/**
 * Resolve standard SKUs to item IDs in org_config.items.
 * Returns a map of sku → item_id (UUID).
 */
async function resolveItemIds(skus: string[]): Promise<Map<string, string>> {
  const uniqueSkus = [...new Set(skus.filter(Boolean))];
  if (uniqueSkus.length === 0) return new Map();

  const { data, error } = await db
    .schema("org_config")
    .from("items")
    .select("id, sku")
    .in("sku", uniqueSkus);

  if (error) {
    console.error("Failed to resolve item IDs:", error);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const item of data || []) {
    map.set(item.sku, item.id);
  }
  return map;
}

export async function processBmcReport(
  report: BmcReportResult,
  emailReceivedAt?: string | Date
): Promise<ProcessResult> {
  // Resolve all standard SKUs → item IDs
  const allSkus = [
    ...report.snapshot.map((s) => s.standardSku).filter(Boolean),
    ...report.transactions.map((t) => t.standardSku).filter(Boolean),
  ] as string[];
  const itemIdMap = await resolveItemIds(allSkus);

  // ── Write inventory snapshots ─────────────────────────────────────
  // Snapshot date = day prior to email receipt (email arrives ~4:35 AM CT,
  // represents end-of-day inventory for the previous day)
  let snapshotDate: string;
  if (emailReceivedAt) {
    const received = new Date(emailReceivedAt);
    received.setDate(received.getDate() - 1);
    snapshotDate = received.toISOString().slice(0, 10);
  } else {
    // Fallback: use yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    snapshotDate = yesterday.toISOString().slice(0, 10);
  }

  const snapshotRows = report.snapshot.map((row) => ({
    warehouse_code: "BMC",
    snapshot_date: snapshotDate,
    item_id: row.standardSku ? itemIdMap.get(row.standardSku) || null : null,
    sku: row.standardSku || row.bmcItemNo,
    qty_on_hand: row.qtyOnHand,
    qty_on_hold: row.qtyOnHold,
    qty_available: row.qtyAvailable,
    base_uom: row.baseUom,
    pallet_count: row.palletCount,
  }));

  if (snapshotRows.length > 0) {
    // Delete existing snapshot for this warehouse+date, then insert fresh
    await db
      .schema("orchard")
      .from("inventory_snapshots")
      .delete()
      .eq("warehouse_code", "BMC")
      .eq("snapshot_date", snapshotDate);

    const { error: snapError } = await db
      .schema("orchard")
      .from("inventory_snapshots")
      .insert(snapshotRows);

    if (snapError) {
      console.error("Failed to write snapshots:", snapError);
      throw new Error(`Snapshot write failed: ${snapError.message}`);
    }
  }

  // ── Write transactions ────────────────────────────────────────────
  // Use ON CONFLICT (entry_no) DO NOTHING for idempotency
  let newTransactions = 0;
  let skippedDuplicates = 0;

  if (report.transactions.length > 0) {
    const txnRows = report.transactions.map((row) => ({
      posting_date: row.postingDate,
      item_id: row.standardSku ? itemIdMap.get(row.standardSku) || null : null,
      bmc_item_no: row.bmcItemNo,
      description: row.description,
      quantity: row.quantity,
      base_quantity: row.baseQuantity,
      entry_type: row.entryType,
      uom: row.uom,
      external_doc_no: row.externalDocNo,
      lot_no: row.lotNo,
      document_no: row.documentNo,
      prod_order_no: row.prodOrderNo,
      order_no: row.orderNo,
      reason_code: row.reasonCode,
      reason_desc: row.reasonDesc,
      entry_no: row.entryNo,
      expiration_date: row.expirationDate,
      production_date: row.productionDate,
      report_date: report.reportDate,
    }));

    // Supabase JS doesn't support ON CONFLICT DO NOTHING directly,
    // so we batch-insert and use upsert with ignoreDuplicates
    const batchSize = 100;
    for (let i = 0; i < txnRows.length; i += batchSize) {
      const batch = txnRows.slice(i, i + batchSize);
      const { data, error: txnError } = await db
        .schema("orchard")
        .from("bmc_transactions")
        .upsert(batch, { onConflict: "entry_no", ignoreDuplicates: true })
        .select("id");

      if (txnError) {
        console.error(`Failed to write transactions batch ${i}:`, txnError);
        throw new Error(`Transaction write failed: ${txnError.message}`);
      }

      newTransactions += data?.length || 0;
    }

    skippedDuplicates = report.transactions.length - newTransactions;
  }

  // Silver receipt_lines is populated by trigger on orchard.bmc_transactions
  // (sync_bmc_purchase_trg). No app-code write needed.

  console.log(
    `BMC ingest: ${snapshotRows.length} snapshot rows, ` +
    `${newTransactions} new txns, ${skippedDuplicates} dups skipped`
  );

  return {
    snapshotRows: snapshotRows.length,
    newTransactions,
    skippedDuplicates,
  };
}
