// One-time backfill: orchard Bronze → orchard_calcs Silver receipt_lines.
// Idempotent — safe to re-run (uses ON CONFLICT via Supabase upsert with onConflict=source,bronze_id).
// Usage: node scripts/backfill-silver-receipts.mjs [--apply]
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import crypto from 'crypto';

const apply = process.argv.includes('--apply');
const env = readFileSync('/Users/ryanbelanger/Projects/orchard-po-creator/.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();
const db = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false }
});

console.log(apply ? '*** APPLY MODE ***' : '--- DRY RUN (pass --apply to execute) ---', '\n');

// ─── Step 1: Resolve location_id → warehouse_code map ──────────────
const { data: locs, error: le } = await db.schema('org_config').from('locations').select('id, code');
if (le) { console.error('locations query failed:', le); process.exit(1); }
const codeByLocId = new Map(locs.map(l => [l.id, l.code]));

// ─── Step 2: Stord backfill ────────────────────────────────────────
console.log('=== Stord backfill ===');

const { data: receipts, error: re } = await db.schema('orchard').from('receipts')
  .select('id, external_id, received_date, location_id, po_id, notes')
  .eq('source', 'Stord');
if (re) { console.error('receipts query failed:', re); process.exit(1); }
const headerById = new Map(receipts.map(r => [r.id, r]));

const { data: stordLines, error: rle } = await db.schema('orchard').from('receipt_lines')
  .select('id, receipt_id, item_id, qty_received, three_pl_sku, lot_number, status, created_at')
  .in('receipt_id', receipts.map(r => r.id));
if (rle) { console.error('receipt_lines query failed:', rle); process.exit(1); }

console.log(`  Stord receipts: ${receipts.length}, receipt_lines: ${stordLines.length}`);

const stordSilverRows = [];
const stordStatusRows = [];
const skippedNoHeader = [];
for (const line of stordLines) {
  const hdr = headerById.get(line.receipt_id);
  if (!hdr) { skippedNoHeader.push(line.id); continue; }
  const whseCode = codeByLocId.get(hdr.location_id) ?? 'STORD';
  stordSilverRows.push({
    id: line.id,
    source: 'stord',
    bronze_table: 'orchard.receipt_lines',
    bronze_id: line.id,
    source_doc_no: hdr.external_id,
    received_date: hdr.received_date,
    warehouse_code: whseCode,
    po_id: hdr.po_id,
    external_ref: hdr.notes,
    item_id: line.item_id,
    qty_received: line.qty_received,
    three_pl_sku: line.three_pl_sku,
    lot_number: line.lot_number,
    created_at: line.created_at,
  });
  stordStatusRows.push({
    receipt_line_id: line.id,
    status: line.status ?? 'Open',
  });
}
console.log(`  Built ${stordSilverRows.length} Silver line rows (skipped ${skippedNoHeader.length} with missing header)`);

// ─── Step 3: BMC backfill ──────────────────────────────────────────
console.log('\n=== BMC backfill ===');

const { data: bmcTxns, error: be } = await db.schema('orchard').from('bmc_transactions')
  .select('id, posting_date, item_id, bmc_item_no, description, base_quantity, quantity, document_no, external_doc_no, lot_no, entry_no, entry_type')
  .eq('entry_type', 'Purchase');
if (be) { console.error('bmc_transactions query failed:', be); process.exit(1); }
console.log(`  BMC Purchase transactions: ${bmcTxns.length}`);

// One Silver line per BMC transaction. source_doc_no = document_no, received_date = posting_date.
// For BMC, base_quantity is the number in base UOM (sticks/cartons). Use base_quantity if present, else quantity.
function uuidFromText(s) {
  // Deterministic UUID v5-style from a string, so re-runs produce the same id (idempotent).
  const hash = crypto.createHash('sha1').update(s).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
}

const bmcSilverRows = [];
const bmcStatusRows = [];
for (const t of bmcTxns) {
  const sid = uuidFromText(`bmc:txn:${t.entry_no}`);
  const qty = Number(t.base_quantity ?? t.quantity ?? 0);
  bmcSilverRows.push({
    id: sid,
    source: 'bmc',
    bronze_table: 'orchard.bmc_transactions',
    bronze_id: String(t.entry_no),
    source_doc_no: t.document_no,
    received_date: t.posting_date,
    warehouse_code: 'BMC',
    po_id: null,
    external_ref: t.external_doc_no,
    item_id: t.item_id,
    qty_received: qty,
    three_pl_sku: t.bmc_item_no,
    lot_number: t.lot_no,
    created_at: new Date().toISOString(),
  });
  bmcStatusRows.push({ receipt_line_id: sid, status: 'Open' });
}
console.log(`  Built ${bmcSilverRows.length} Silver line rows from BMC`);

// ─── Step 4: Insert ────────────────────────────────────────────────
console.log('\n=== Inserts ===');
console.log(`  Total Silver rows to upsert: ${stordSilverRows.length + bmcSilverRows.length}`);
console.log(`  Total status rows to upsert: ${stordStatusRows.length + bmcStatusRows.length}`);

if (apply) {
  const allLines = [...stordSilverRows, ...bmcSilverRows];
  const allStatuses = [...stordStatusRows, ...bmcStatusRows];

  const batchSize = 200;
  let inserted = 0;
  for (let i = 0; i < allLines.length; i += batchSize) {
    const batch = allLines.slice(i, i + batchSize);
    const { error } = await db.schema('orchard_calcs').from('receipt_lines')
      .upsert(batch, { onConflict: 'source,bronze_id', ignoreDuplicates: true });
    if (error) { console.error('insert receipt_lines failed:', error); process.exit(1); }
    inserted += batch.length;
    process.stdout.write(`\r  receipt_lines: ${inserted}/${allLines.length}`);
  }
  console.log();

  let sIns = 0;
  for (let i = 0; i < allStatuses.length; i += batchSize) {
    const batch = allStatuses.slice(i, i + batchSize);
    const { error } = await db.schema('orchard_calcs').from('receipt_line_statuses')
      .upsert(batch, { onConflict: 'receipt_line_id', ignoreDuplicates: true });
    if (error) { console.error('insert statuses failed:', error); process.exit(1); }
    sIns += batch.length;
    process.stdout.write(`\r  statuses: ${sIns}/${allStatuses.length}`);
  }
  console.log();

  // ─── Step 5: Verify ───────────────────────────────────────────────
  const { count: rlCount } = await db.schema('orchard_calcs').from('receipt_lines').select('*', { count: 'exact', head: true });
  const { count: stCount } = await db.schema('orchard_calcs').from('receipt_line_statuses').select('*', { count: 'exact', head: true });
  const { count: vrCount } = await db.schema('orchard_calcs').from('v_receipts').select('*', { count: 'exact', head: true });
  console.log('\nFinal counts:');
  console.log(`  orchard_calcs.receipt_lines        = ${rlCount}`);
  console.log(`  orchard_calcs.receipt_line_statuses = ${stCount}`);
  console.log(`  orchard_calcs.v_receipts (rollup)   = ${vrCount} headers`);
}

console.log(apply ? '\n✓ Done.' : '\n(dry run — pass --apply to execute)');
