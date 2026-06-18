// Read-only diagnostic: trace May 29 Stord receipts through the pipeline.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = readFileSync('/Users/ryanbelanger/Projects/orchard-po-creator/.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();
const db = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

const j = (x) => JSON.stringify(x, null, 2);

// 1. Ingested emails around May 27-31
console.log('=== 1. INGESTED EMAILS (May 26 – Jun 1) ===');
const { data: emails, error: e1 } = await db.schema('orchard').from('ingested_emails')
  .select('id, received_at, from_address, subject, status')
  .gte('received_at', '2026-05-26').lte('received_at', '2026-06-01')
  .order('received_at', { ascending: true });
if (e1) console.log('ERR', e1.message); else for (const m of emails ?? []) {
  console.log(`  ${m.received_at?.slice(0,16)} | ${m.from_address} | "${m.subject}" | ${m.status} | ${m.id}`);
}

// 2. Ingested documents that are stord_adjustments (recent)
console.log('\n=== 2. STORD ADJUSTMENT DOCUMENTS (recent) ===');
const { data: docs, error: e2 } = await db.schema('orchard').from('ingested_documents')
  .select('id, email_id, filename, document_type, status, parsed_data, created_at')
  .eq('document_type', 'stord_adjustments')
  .order('created_at', { ascending: false }).limit(8);
if (e2) console.log('ERR', e2.message); else for (const d of docs ?? []) {
  console.log(`\n  doc ${d.id} | ${d.created_at?.slice(0,16)} | ${d.filename} | status=${d.status}`);
  const p = d.parsed_data || {};
  console.log(`    dateRange: ${j(p.dateRange)} | totalRows: ${p.totalRows} | newReceipts: ${p.newReceipts} | skippedExisting: ${p.skippedExisting} | receiptRows: ${p.totalReceiptRows}`);
  if (p.failedOrders?.length) console.log(`    FAILED ORDERS: ${j(p.failedOrders)}`);
  if (p.error) console.log(`    ERROR: ${p.error}`);
}

// 3. Bronze receipts received around May 29
console.log('\n=== 3. BRONZE orchard.receipts (received_date May 27 – Jun 1) ===');
const { data: bReceipts, error: e3 } = await db.schema('orchard').from('receipts')
  .select('id, receipt_number, received_date, source, external_id, location_id, created_at')
  .gte('received_date', '2026-05-27').lte('received_date', '2026-06-01')
  .order('received_date', { ascending: true });
if (e3) console.log('ERR', e3.message); else {
  console.log(`  ${bReceipts?.length ?? 0} receipts`);
  for (const r of bReceipts ?? []) console.log(`  ${r.received_date} | ${r.receipt_number} | ${r.source} | ext=${r.external_id} | loc=${r.location_id} | created=${r.created_at?.slice(0,16)} | ${r.id}`);
}

// 3b. Bronze receipt_lines for those receipts
const bIds = (bReceipts ?? []).map((r) => r.id);
if (bIds.length) {
  const { data: bLines } = await db.schema('orchard').from('receipt_lines')
    .select('id, receipt_id, item_id, qty_received, three_pl_sku, lot_number, status').in('receipt_id', bIds);
  console.log(`\n  Bronze receipt_lines: ${bLines?.length ?? 0}`);
  for (const l of bLines ?? []) console.log(`    line ${l.id} | rcpt=${l.receipt_id} | item=${l.item_id ?? 'NULL'} | sku=${l.three_pl_sku} | qty=${l.qty_received} | lot=${l.lot_number ?? '-'} | ${l.status}`);
}

// 4. Silver receipt_lines around May 29
console.log('\n=== 4. SILVER orchard_calcs.receipt_lines (received_date May 27 – Jun 1) ===');
const { data: sLines, error: e4 } = await db.schema('orchard_calcs').from('receipt_lines')
  .select('id, source, received_date, warehouse_code, source_doc_no, item_id, three_pl_sku, lot_number, qty_received, po_id')
  .gte('received_date', '2026-05-27').lte('received_date', '2026-06-01')
  .order('received_date', { ascending: true });
if (e4) console.log('ERR', e4.message); else {
  console.log(`  ${sLines?.length ?? 0} silver lines`);
  for (const l of sLines ?? []) console.log(`  ${l.received_date} | ${l.source} | doc=${l.source_doc_no} | wh=${l.warehouse_code} | item=${l.item_id ?? 'NULL'} | sku=${l.three_pl_sku} | qty=${l.qty_received} | ${l.id}`);
}

// 5. Cross-check: bronze line ids present in silver?
if (bIds.length) {
  const { data: bLines2 } = await db.schema('orchard').from('receipt_lines').select('id').in('receipt_id', bIds);
  const bronzeLineIds = (bLines2 ?? []).map((l) => l.id);
  if (bronzeLineIds.length) {
    const { data: sMatch } = await db.schema('orchard_calcs').from('receipt_lines').select('id').in('id', bronzeLineIds);
    const sSet = new Set((sMatch ?? []).map((r) => r.id));
    const orphans = bronzeLineIds.filter((id) => !sSet.has(id));
    console.log(`\n=== 5. BRONZE→SILVER PROMOTION CHECK ===`);
    console.log(`  Bronze lines: ${bronzeLineIds.length} | Present in silver: ${sSet.size} | MISSING from silver: ${orphans.length}`);
    if (orphans.length) console.log(`  Orphan bronze line ids (trigger did not promote): ${j(orphans)}`);
  }
}

console.log('\nDone.');
