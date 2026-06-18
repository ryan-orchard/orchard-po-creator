// Recover the Stord receipts missed from the May 29 and Jun 1 reports.
//
// May 29 (accounting@drinkmagna.com report):
//   "Bulk Sticks - PO27, 30, 31" — the report shows positive + negative rows
//   that net to zero due to Stord lot-correction processing. Recovers using
//   positive-only rows (the actual received quantities).
//
// Jun 1 (Domo "Previous Day Inbound Report"):
//   "Bulk Sticks - PO27, 30, 31" and "Bulk Sticks 2 - PO27, 30, 31" — all positive.
//   NOTE: "Bulk Sticks - PO27, 30, 31" appears in both reports. If May 29 and
//   Jun 1 represent the same physical receipt (Stord finalized it on Jun 1),
//   only one should be loaded. The script will skip the Jun 1 one if May 29
//   was already created (same external_id).
//
// Usage: node scripts/recover-stord-may29-jun01.mjs [--apply]
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';

const apply = process.argv.includes('--apply');
const env = readFileSync('/Users/ryanbelanger/Projects/orchard-po-creator/.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();
const db = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(apply ? '*** APPLY MODE ***' : '--- DRY RUN (pass --apply to execute) ---\n');

const SKU_MAP = JSON.parse(readFileSync('/Users/ryanbelanger/Projects/orchard-po-creator/clients/magna/config/stord-sku-mapping.json', 'utf8'));
const FACILITY_MAP = { '7e59a430-ae3b-4915-8414-6c064d0b9876': 'STORD', RNOs003: 'STORD', RNOs004: 'STORD' };
const resolveF = (f) => FACILITY_MAP[f] ?? f;

function parseReport(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', raw: false });
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const rows = [];
  for (let i = 1; i < rawRows.length; i++) {
    const r = rawRows[i]; if (!r || r.length === 0 || r[0] == null) continue;
    rows.push({ adjustmentDate: String(r[0] ?? ''), sku: String(r[1] ?? ''), reason: String(r[2] ?? ''), reasonType: String(r[3] ?? ''), inventoryCategory: String(r[4] ?? ''), adjustedQuantity: Number(r[6]) || 0, facility: String(r[11] ?? ''), orderNumber: String(r[12] ?? ''), lotNumber: String(r[13] ?? '') });
  }
  return rows;
}

function buildReceipts(rows, label) {
  const receiptRows = rows.filter(r => r.reason === 'Receipt Confirmation' && r.reasonType === 'Receipt' && r.inventoryCategory === 'Receiving');
  const groups = {};
  for (const r of receiptRows) {
    const k = r.orderNumber || 'UNKNOWN';
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  const receipts = [];
  for (const [orderNumber, orderRows] of Object.entries(groups)) {
    let earliestDate = orderRows[0].adjustmentDate;
    for (const r of orderRows) { if (r.adjustmentDate < earliestDate) earliestDate = r.adjustmentDate; }
    const facilityCode = resolveF(orderRows[0].facility);
    // Only count positive adjustments — negatives are Stord lot corrections
    const lineAgg = {};
    for (const r of orderRows) {
      if (r.adjustedQuantity <= 0) continue;
      const k = `${r.sku}||${r.lotNumber}`;
      if (!lineAgg[k]) lineAgg[k] = { qty: 0, sku: r.sku, lot: r.lotNumber };
      lineAgg[k].qty += r.adjustedQuantity;
    }
    const positiveLines = Object.values(lineAgg).filter(l => l.qty > 0);
    receipts.push({ orderNumber, date: earliestDate.slice(0, 10), facilityCode, lines: positiveLines, source: label });
  }
  return receipts;
}

// ── Download and parse reports ──────────────────────────────────────
const { data: b1 } = await db.storage.from('ingest').download('a8ba7796-c18e-40a6-a59e-cc7fd244020d/Inventory Adjustments.csv');
const rows29 = parseReport(Buffer.from(await b1.arrayBuffer()));
const receipts29 = buildReceipts(rows29, 'May 29 accounting email');

const { data: b2 } = await db.storage.from('ingest').download('a2187e23-b68a-48d1-bff4-65acfd65129f/Inventory Adjustments.csv');
const rowsJun1 = parseReport(Buffer.from(await b2.arrayBuffer()));
const receiptsJun1 = buildReceipts(rowsJun1, 'Jun 1 Domo report');

const allReceipts = [...receipts29, ...receiptsJun1];

// ── Dedup check by (external_id, received_date) ─────────────────────
const orderNumbers = [...new Set(allReceipts.map(r => r.orderNumber))];
const { data: existing } = await db.schema('orchard').from('receipts').select('external_id, received_date').in('external_id', orderNumbers);
// Key: "external_id::received_date" — matches the updated ingest dedup logic
const existingSet = new Set((existing ?? []).map(e => `${e.external_id}::${e.received_date}`));

console.log('=== Receipts to process ===');
for (const r of allReceipts) {
  const alreadyExists = existingSet.has(`${r.orderNumber}::${r.date}`);
  console.log(`\n[${r.source}] "${r.orderNumber}" on ${r.date} — ${alreadyExists ? 'SKIP (already in bronze)' : 'CREATE'}`);
  for (const l of r.lines) console.log(`  ${l.sku} lot=${l.lot} qty=${l.qty}`);
  if (r.lines.length === 0) console.log('  (no positive lines — nothing to load)');
}

if (!apply) {
  console.log('\n(dry run — pass --apply to execute)');
  process.exit(0);
}

// ── Resolve locations and items ─────────────────────────────────────
const { data: locs } = await db.schema('org_config').from('locations').select('id, code');
const locByCode = new Map((locs ?? []).map(l => [l.code, l.id]));

const allSkus = [...new Set(allReceipts.flatMap(r => r.lines.map(l => SKU_MAP[l.sku]?.standardSku)).filter(Boolean))];
const { data: items } = await db.schema('org_config').from('items').select('id, sku').in('sku', allSkus.length ? allSkus : ['__none__']);
const itemBySku = new Map((items ?? []).map(i => [i.sku, i.id]));

// ── Insert ──────────────────────────────────────────────────────────
let created = 0;
for (const r of allReceipts) {
  if (existingSet.has(`${r.orderNumber}::${r.date}`)) {
    console.log(`\nSKIP "${r.orderNumber}" on ${r.date} — already in bronze`);
    continue;
  }
  if (r.lines.length === 0) {
    console.log(`\nSKIP "${r.orderNumber}" — no positive lines`);
    continue;
  }

  const { data: rcpNum } = await db.rpc('next_sequence', { p_prefix: 'RCP' });
  const locationId = locByCode.get(r.facilityCode) ?? null;

  const { data: receipt, error: re } = await db.schema('orchard').from('receipts').insert({
    receipt_number: rcpNum, received_date: r.date, location_id: locationId,
    source: 'Stord', external_id: r.orderNumber, notes: null, po_id: null,
  }).select('id').single();

  if (re || !receipt) { console.error(`FAILED receipt: ${re?.message ?? 'null'}`); continue; }

  const lineRows = r.lines.map(l => {
    const m = SKU_MAP[l.sku];
    return { receipt_id: receipt.id, item_id: m?.standardSku ? itemBySku.get(m.standardSku) ?? null : null, qty_received: l.qty, three_pl_sku: l.sku, lot_number: l.lot || null, status: 'Open' };
  });

  const { error: le } = await db.schema('orchard').from('receipt_lines').insert(lineRows);
  if (le) { console.error(`FAILED lines: ${le.message}`); continue; }

  // Silver: upsert to orchard_calcs.receipt_lines
  const { data: insertedLines } = await db.schema('orchard').from('receipt_lines').select('id, item_id, qty_received, three_pl_sku, lot_number').eq('receipt_id', receipt.id);
  const silverRows = (insertedLines ?? []).map(line => ({
    id: line.id, client_id: 'magna', source: 'stord', received_date: r.date,
    warehouse_code: r.facilityCode, source_doc_no: r.orderNumber, item_id: line.item_id,
    three_pl_sku: line.three_pl_sku, lot_number: line.lot_number, qty_received: line.qty_received, po_id: null,
  }));
  const { error: se } = await db.schema('orchard_calcs').from('receipt_lines').upsert(silverRows, { onConflict: 'id' });
  if (se) { console.error(`FAILED silver: ${se.message}`); continue; }

  const { error: ste } = await db.schema('orchard_calcs').from('receipt_line_statuses').upsert(
    (insertedLines ?? []).map(l => ({ receipt_line_id: l.id, status: 'Open' })), { onConflict: 'receipt_line_id' }
  );
  if (ste) console.error(`FAILED status: ${ste.message}`);

  console.log(`\nCREATED ${rcpNum} for "${r.orderNumber}" (${r.date}) — ${lineRows.length} lines`);
  existingSet.add(`${r.orderNumber}::${r.date}`);
  created++;
}

console.log(`\nDone. Created ${created} receipts.`);
