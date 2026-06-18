// Recovery: insert the 3 Stord receipts from 2026-05-27 that failed silently.
// Downloads the CSV from storage, parses only the missing orders,
// writes bronze (orchard.receipts + receipt_lines) + silver (orchard_calcs).
// Idempotent — checks bronze before inserting.
// Usage: node scripts/recover-stord-20260527.mjs [--apply]
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const apply = process.argv.includes('--apply');
const env = readFileSync('/Users/ryanbelanger/Projects/orchard-po-creator/.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();
const db = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log(apply ? '*** APPLY MODE ***' : '--- DRY RUN (pass --apply to execute) ---\n');

// SKU mapping (same as client-config.ts)
const SKU_MAPPING = JSON.parse(
  readFileSync('/Users/ryanbelanger/Projects/orchard-po-creator/clients/magna/config/stord-sku-mapping.json', 'utf8')
);

const FACILITY_MAP = {
  '7e59a430-ae3b-4915-8414-6c064d0b9876': 'STORD',
  RNOs003: 'STORD',
  RNOs004: 'STORD',
};

function resolveFacilityCode(id) {
  return FACILITY_MAP[id] ?? id;
}

// CSV parser (handles quoted fields)
function csvParse(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ',') { out.push(cur); cur = ''; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ── Download today's file ───────────────────────────────────────────
const STORAGE_PATH = '0ba8fc07-16a2-46f2-9e41-b29cd2fd7da2/Inventory Adjustments.csv';
const { data: blob } = await db.storage.from('ingest').download(STORAGE_PATH);
if (!blob) { console.error('Failed to download file'); process.exit(1); }
const text = Buffer.from(await blob.arrayBuffer()).toString('utf-8');
const lines = text.split(/\r?\n/);

const header = csvParse(lines[0]).map((s) => s.trim());
const idx = (n) => header.findIndex((h) => h.toLowerCase() === n.toLowerCase());
const iDate = idx('Adjustment Date'), iSku = idx('SKU'), iReason = idx('Reason');
const iRT = idx('Reason Type'), iCat = idx('Inventory Category');
const iQty = idx('Adjusted Quantity'), iOrd = idx('Order Number');
const iLot = idx('Lot Number'), iFac = idx('Facility');

// ── Parse receipt rows ──────────────────────────────────────────────
const receiptRows = [];
for (let i = 1; i < lines.length; i++) {
  const r = csvParse(lines[i]);
  if (!r[iDate]) continue;
  if (r[iReason] === 'Receipt Confirmation' && r[iRT] === 'Receipt' && r[iCat] === 'Receiving') {
    receiptRows.push({
      date: r[iDate], sku: r[iSku], qty: Number(r[iQty]) || 0,
      order: r[iOrd], lot: r[iLot], facility: r[iFac],
    });
  }
}

// Group by order number
const groups = {};
for (const r of receiptRows) {
  if (!groups[r.order]) groups[r.order] = [];
  groups[r.order].push(r);
}
console.log(`Parsed ${receiptRows.length} receipt rows, ${Object.keys(groups).length} unique orders\n`);

// ── Check which already exist in bronze ─────────────────────────────
const orderNumbers = Object.keys(groups);
const { data: existing } = await db.schema('orchard').from('receipts')
  .select('external_id').in('external_id', orderNumbers);
const existingSet = new Set((existing ?? []).map((r) => r.external_id));

const missing = orderNumbers.filter((o) => !existingSet.has(o));
console.log(`Already in bronze: ${existingSet.size} orders`);
console.log(`Missing from bronze: ${missing.length} orders`);
for (const o of missing) {
  const rows = groups[o];
  console.log(`  "${o}" — ${rows.length} rows, date: ${rows[0].date.slice(0, 10)}`);
}

if (missing.length === 0) {
  console.log('\nNothing to recover.');
  process.exit(0);
}

// ── Resolve locations + items ───────────────────────────────────────
const { data: locs } = await db.schema('org_config').from('locations').select('id, code');
const locByCode = new Map((locs ?? []).map((l) => [l.code, l.id]));

const standardSkus = [...new Set(
  receiptRows.map((r) => SKU_MAPPING[r.sku]?.standardSku).filter(Boolean)
)];
const { data: items } = await db.schema('org_config').from('items')
  .select('id, sku').in('sku', standardSkus.length > 0 ? standardSkus : ['__none__']);
const itemBySku = new Map((items ?? []).map((i) => [i.sku, i.id]));

// ── Insert missing orders ───────────────────────────────────────────
let created = 0;
for (const orderNumber of missing) {
  const orderRows = groups[orderNumber];

  // Earliest date
  let earliest = orderRows[0].date;
  for (const r of orderRows) { if (r.date < earliest) earliest = r.date; }

  const facilityCode = resolveFacilityCode(orderRows[0].facility);
  const locationId = locByCode.get(facilityCode) ?? null;

  // Aggregate by SKU + lot
  const agg = {};
  for (const r of orderRows) {
    const k = `${r.sku}||${r.lot}`;
    if (!agg[k]) agg[k] = { qty: 0, sku: r.sku, lot: r.lot };
    agg[k].qty += r.qty;
  }

  console.log(`\n"${orderNumber}" — date: ${earliest.slice(0, 10)}, facility: ${facilityCode}, ${Object.keys(agg).length} lines`);
  for (const [, v] of Object.entries(agg)) {
    const mapping = SKU_MAPPING[v.sku];
    const stdSku = mapping?.standardSku ?? '(unmapped)';
    const itemId = mapping?.standardSku ? itemBySku.get(mapping.standardSku) : null;
    console.log(`  ${v.sku} → ${stdSku} (item: ${itemId ?? 'null'}), qty: ${v.qty}, lot: ${v.lot || '-'}`);
  }

  if (!apply) continue;

  // Generate receipt number
  const { data: rcpNum } = await db.rpc('next_sequence', { p_prefix: 'RCP' });

  // Bronze: receipt header
  const { data: receipt, error: re } = await db.schema('orchard').from('receipts').insert({
    receipt_number: rcpNum,
    received_date: earliest.slice(0, 10),
    location_id: locationId,
    source: 'Stord',
    external_id: orderNumber,
    notes: null,
    po_id: null,
  }).select('id').single();

  if (re || !receipt) { console.error(`  FAILED receipt insert: ${re?.message}`); continue; }

  // Bronze: receipt lines
  const lineRows = Object.values(agg).map((v) => {
    const mapping = SKU_MAPPING[v.sku];
    const itemId = mapping?.standardSku ? itemBySku.get(mapping.standardSku) ?? null : null;
    return {
      receipt_id: receipt.id,
      item_id: itemId,
      qty_received: v.qty,
      three_pl_sku: v.sku,
      lot_number: v.lot || null,
      status: 'Open',
    };
  });

  const { data: insertedLines, error: le } = await db.schema('orchard').from('receipt_lines')
    .insert(lineRows).select('id, item_id, qty_received, three_pl_sku, lot_number');

  if (le) { console.error(`  FAILED lines insert: ${le.message}`); continue; }
  console.log(`  Bronze: ${rcpNum} + ${insertedLines.length} lines`);

  // Silver: orchard_calcs.receipt_lines
  const silverRows = insertedLines.map((line) => ({
    id: line.id,
    client_id: 'magna',
    source: 'stord',
    received_date: earliest.slice(0, 10),
    warehouse_code: facilityCode,
    source_doc_no: orderNumber,
    item_id: line.item_id,
    three_pl_sku: line.three_pl_sku,
    lot_number: line.lot_number,
    qty_received: line.qty_received,
    po_id: null,
  }));

  const { error: se } = await db.schema('orchard_calcs').from('receipt_lines')
    .upsert(silverRows, { onConflict: 'id' });
  if (se) { console.error(`  FAILED silver insert: ${se.message}`); continue; }

  // Silver: receipt_line_statuses
  const statusRows = insertedLines.map((line) => ({
    receipt_line_id: line.id,
    status: 'Open',
  }));
  const { error: ste } = await db.schema('orchard_calcs').from('receipt_line_statuses')
    .upsert(statusRows, { onConflict: 'receipt_line_id' });
  if (ste) console.error(`  FAILED status insert: ${ste.message}`);

  console.log(`  Silver: ${silverRows.length} lines + statuses`);
  created++;
}

console.log(`\n${apply ? `Done. Created ${created} receipts.` : '(dry run — pass --apply to execute)'}`);
