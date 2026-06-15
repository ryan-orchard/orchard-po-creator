// Backfill Stord receipts missed while the parser was rejecting the renamed
// "Adjustment UTC Date" column (every report since ~Jun 3, 2026).
//
// Reprocesses the stored attachments of all failed/pending stord_adjustments
// documents through the FIXED header-name-based parser + the same ingest logic
// the app now uses. Idempotent: dedups by (external_id, received_date) against
// existing receipts and within this run, so re-running is safe.
//
// Also marks the reprocessed documents as approved so the inbox reflects
// reality (the inbox API already excludes report types by document_type).
//
// Usage:
//   node scripts/backfill-stord-june.mjs            # dry run
//   node scripts/backfill-stord-june.mjs --apply    # execute
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import * as XLSX from "xlsx";

const ROOT = "/Users/ryanbelanger/Projects/orchard-po-creator";
const apply = process.argv.includes("--apply");
const env = readFileSync(`${ROOT}/.env.local`, "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
const db = createClient(get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SKU_MAP = JSON.parse(
  readFileSync(`${ROOT}/clients/magna/config/stord-sku-mapping.json`, "utf8")
);
const FACILITY_MAP = {
  "7e59a430-ae3b-4915-8414-6c064d0b9876": "STORD",
  RNOs003: "STORD",
  RNOs004: "STORD",
};
const resolveFacility = (f) => FACILITY_MAP[f] ?? f;

console.log(apply ? "*** APPLY MODE ***\n" : "--- DRY RUN (pass --apply to execute) ---\n");

// ── Fixed parser (header-name mapping; mirrors stord-adjustments-parser.ts) ──
const ESSENTIAL = ["adjustmentDate", "sku", "reason", "reasonType", "inventoryCategory", "adjustedQuantity", "orderNumber"];
const norm = (h) => String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ");
function buildColumnMap(headers) {
  const n = headers.map(norm);
  const exact = (name) => n.findIndex((h) => h === name);
  let dateIdx = n.findIndex((h) => h.includes("adjustment") && h.includes("date"));
  if (dateIdx < 0) dateIdx = exact("date");
  return {
    adjustmentDate: dateIdx, sku: exact("sku"), reason: exact("reason"),
    reasonType: exact("reason type"), inventoryCategory: exact("inventory category"),
    adjustedQuantity: exact("adjusted quantity"), facility: exact("facility"),
    orderNumber: exact("order number"), lotNumber: exact("lot number"), notes: exact("notes"),
  };
}
const cell = (row, i) => (i >= 0 ? row[i] : undefined);
function parseRows(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (raw.length === 0) return [];
  const cm = buildColumnMap(raw[0]);
  const missing = ESSENTIAL.filter((f) => cm[f] < 0);
  if (missing.length) throw new Error(`Not a Stord adjustments report — missing: ${missing.join(", ")}`);
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.length === 0) continue;
    const dc = cell(r, cm.adjustmentDate), sc = cell(r, cm.sku);
    if (dc == null && sc == null) continue;
    rows.push({
      adjustmentDate: String(dc ?? ""), sku: String(sc ?? ""),
      reason: String(cell(r, cm.reason) ?? ""), reasonType: String(cell(r, cm.reasonType) ?? ""),
      inventoryCategory: String(cell(r, cm.inventoryCategory) ?? ""),
      adjustedQuantity: Number(cell(r, cm.adjustedQuantity)) || 0,
      facility: String(cell(r, cm.facility) ?? ""), orderNumber: String(cell(r, cm.orderNumber) ?? ""),
      lotNumber: String(cell(r, cm.lotNumber) ?? ""), notes: String(cell(r, cm.notes) ?? ""),
    });
  }
  return rows;
}

// ── Build receipts from rows (mirrors stord-adjustments-ingest.ts) ──
function buildReceipts(rows) {
  const receiptRows = rows.filter(
    (r) => r.reason === "Receipt Confirmation" && r.reasonType === "Receipt" && r.inventoryCategory === "Receiving"
  );
  const groupKey = (r) => r.orderNumber || r.notes || "UNKNOWN";
  const groups = {};
  for (const r of receiptRows) {
    const k = groupKey(r);
    (groups[k] ||= []).push(r);
  }
  const receipts = [];
  for (const [orderNumber, orderRows] of Object.entries(groups)) {
    let earliest = orderRows[0].adjustmentDate;
    for (const r of orderRows) if (r.adjustmentDate < earliest) earliest = r.adjustmentDate;
    const lineAgg = {};
    for (const r of orderRows) {
      if (r.adjustedQuantity <= 0) continue;
      const k = `${r.sku}||${r.lotNumber}`;
      (lineAgg[k] ||= { qty: 0, sku: r.sku, lot: r.lotNumber }).qty += r.adjustedQuantity;
    }
    const lines = Object.values(lineAgg).filter((l) => l.qty > 0);
    if (lines.length === 0) continue;
    receipts.push({
      orderNumber, date: earliest.slice(0, 10),
      facilityCode: resolveFacility(orderRows[0].facility), lines,
    });
  }
  return receipts;
}

// ── Load failed/pending stord docs ──
// Scan ALL stord_adjustments docs regardless of status — idempotent via
// receipt-level (external_id, received_date) dedup. Status-agnostic so a prior
// partial run (which may have flipped docs to approved/failed) is recoverable.
const { data: docs } = await db
  .schema("orchard")
  .from("ingested_documents")
  .select("id, storage_path, status, created_at, ingested_emails(subject)")
  .eq("document_type", "stord_adjustments")
  .order("created_at", { ascending: false });

console.log(`Found ${docs?.length ?? 0} stord_adjustments documents\n`);

// Parse each, collect candidate receipts (tag with source doc)
const candidates = [];
const docResults = []; // { id, subject, date, receiptRows, status }
for (const d of docs ?? []) {
  if (!d.storage_path) {
    docResults.push({ id: d.id, subject: d.ingested_emails?.subject, note: "no storage_path", count: 0 });
    continue;
  }
  const { data: file, error } = await db.storage.from("ingest").download(d.storage_path);
  if (error) {
    docResults.push({ id: d.id, subject: d.ingested_emails?.subject, note: `download error: ${error.message}`, count: 0 });
    continue;
  }
  let receipts = [];
  try {
    receipts = buildReceipts(parseRows(Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    docResults.push({ id: d.id, subject: d.ingested_emails?.subject, note: `parse error: ${e.message}`, count: 0 });
    continue;
  }
  for (const r of receipts) candidates.push(r);
  docResults.push({ id: d.id, subject: d.ingested_emails?.subject, date: d.created_at?.slice(0, 10), note: receipts.length ? "" : "empty (no-op)", count: receipts.length });
}

// ── Dedup vs existing receipts and within run ──
const orderNumbers = [...new Set(candidates.map((r) => r.orderNumber))];
const { data: existing } = await db
  .schema("orchard")
  .from("receipts")
  .select("external_id, received_date")
  .in("external_id", orderNumbers.length ? orderNumbers : ["__none__"]);
const seen = new Set((existing ?? []).map((e) => `${e.external_id}::${e.received_date}`));

const toCreate = [];
for (const r of candidates) {
  const key = `${r.orderNumber}::${r.date}`;
  if (seen.has(key)) continue;
  seen.add(key);
  toCreate.push(r);
}

console.log("=== Documents scanned ===");
for (const dr of docResults) {
  console.log(`  ${dr.date ?? "?"} | ${dr.subject ?? "?"} | receipts=${dr.count}${dr.note ? ` | ${dr.note}` : ""}`);
}
console.log(`\n=== Receipts to CREATE (${toCreate.length}) ===`);
for (const r of toCreate) {
  const units = r.lines.reduce((s, l) => s + l.qty, 0);
  console.log(`  ${r.date} | "${r.orderNumber}" | ${r.lines.length} lines, ${units.toLocaleString()} units`);
  for (const l of r.lines) {
    const mapped = SKU_MAP[l.sku]?.standardSku ?? "(unmapped)";
    console.log(`      ${l.sku} → ${mapped} lot=${l.lot || "—"} qty=${l.qty.toLocaleString()}`);
  }
}

if (!apply) {
  console.log("\n(dry run — pass --apply to create receipts and mark documents approved)");
  process.exit(0);
}

// ── Resolve locations + items ──
const { data: locs } = await db.schema("org_config").from("locations").select("id, code");
const locByCode = new Map((locs ?? []).map((l) => [l.code, l.id]));
const allSkus = [...new Set(toCreate.flatMap((r) => r.lines.map((l) => SKU_MAP[l.sku]?.standardSku)).filter(Boolean))];
const { data: items } = await db.schema("org_config").from("items").select("id, sku").in("sku", allSkus.length ? allSkus : ["__none__"]);
const itemBySku = new Map((items ?? []).map((i) => [i.sku, i.id]));

// ── Insert receipts (silver promotion handled by DB trigger) ──
let created = 0;
for (const r of toCreate) {
  const { data: rcpNum } = await db.rpc("next_sequence", { p_prefix: "RCP" });
  const { data: receipt, error: re } = await db.schema("orchard").from("receipts").insert({
    receipt_number: rcpNum, received_date: r.date, location_id: locByCode.get(r.facilityCode) ?? null,
    source: "Stord", external_id: r.orderNumber, notes: null, po_id: null,
  }).select("id").single();
  if (re || !receipt) { console.error(`FAILED receipt "${r.orderNumber}" ${r.date}: ${re?.message ?? "null"}`); continue; }

  const lineRows = r.lines.map((l) => ({
    receipt_id: receipt.id,
    item_id: SKU_MAP[l.sku]?.standardSku ? itemBySku.get(SKU_MAP[l.sku].standardSku) ?? null : null,
    qty_received: l.qty, three_pl_sku: l.sku, lot_number: l.lot || null, status: "Open",
  }));
  const { error: le } = await db.schema("orchard").from("receipt_lines").insert(lineRows);
  if (le) { console.error(`FAILED lines "${r.orderNumber}": ${le.message}`); continue; }
  created++;
  console.log(`  created ${rcpNum} — "${r.orderNumber}" ${r.date}`);
}

// ── Mark reprocessed documents as approved ──
const docIds = docResults.filter((d) => !d.note?.includes("error")).map((d) => d.id);
if (docIds.length) {
  const { error: ue } = await db.schema("orchard").from("ingested_documents")
    .update({
      status: "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: "Orchard AI (backfill)",
    })
    .in("id", docIds);
  if (ue) console.error(`Failed to update documents: ${ue.message}`);
  else console.log(`\nMarked ${docIds.length} documents approved (cleared from inbox)`);
}

console.log(`\n=== DONE: created ${created} receipts ===`);
