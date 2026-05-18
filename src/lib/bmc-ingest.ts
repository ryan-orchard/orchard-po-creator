/**
 * BMC Report Ingestion — writes parsed BMC report data to Supabase.
 *
 * - Inventory snapshots: upsert (replace per warehouse+date+item)
 * - Transactions: insert with ON CONFLICT skip (idempotent via entry_no)
 * - Silver receipt_lines: Purchase entries also flow to orchard_calcs.receipt_lines
 */
import crypto from "crypto";
import { db } from "./supabase";
import type { BmcReportResult } from "./bmc-parser";

// Deterministic UUID from a stable string (so re-runs are idempotent).
function uuidFromText(s: string): string {
  const h = crypto.createHash("sha1").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

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

  // ── Mirror Purchase entries to Silver (orchard_calcs.receipt_lines) ──
  // BMC "Purchase" entries are inbound receipts. Other entry types
  // (Consumption, Output, Adjustments) stay in bmc_transactions only.
  const purchases = report.transactions.filter((t) => t.entryType === "Purchase");
  if (purchases.length > 0) {
    const silverRows = purchases.map((t) => {
      const id = uuidFromText(`bmc:txn:${t.entryNo}`);
      return {
        id,
        source: "bmc",
        bronze_table: "orchard.bmc_transactions",
        bronze_id: String(t.entryNo),
        source_doc_no: t.documentNo,
        received_date: t.postingDate,
        warehouse_code: "BMC",
        po_id: null,
        external_ref: t.externalDocNo,
        item_id: t.standardSku ? itemIdMap.get(t.standardSku) || null : null,
        qty_received: Number(t.baseQuantity ?? t.quantity ?? 0),
        three_pl_sku: t.bmcItemNo,
        lot_number: t.lotNo,
      };
    });

    const { error: silverErr } = await db
      .schema("orchard_calcs")
      .from("receipt_lines")
      .upsert(silverRows, { onConflict: "source,bronze_id", ignoreDuplicates: true });

    if (silverErr) {
      console.error("Failed to write Silver receipt_lines:", silverErr);
      throw new Error(`Silver receipt_lines write failed: ${silverErr.message}`);
    }

    const statusRows = purchases.map((t) => ({
      receipt_line_id: uuidFromText(`bmc:txn:${t.entryNo}`),
      status: "Open",
    }));
    const { error: statusErr } = await db
      .schema("orchard_calcs")
      .from("receipt_line_statuses")
      .upsert(statusRows, { onConflict: "receipt_line_id", ignoreDuplicates: true });

    if (statusErr) {
      console.error("Failed to write Silver receipt_line_statuses:", statusErr);
      throw new Error(`Silver status write failed: ${statusErr.message}`);
    }
  }

  console.log(
    `BMC ingest: ${snapshotRows.length} snapshot rows, ` +
    `${newTransactions} new txns, ${skippedDuplicates} dups skipped, ` +
    `${purchases.length} Silver receipt lines`
  );

  return {
    snapshotRows: snapshotRows.length,
    newTransactions,
    skippedDuplicates,
  };
}
