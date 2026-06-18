// Read-only: storage bucket contents + all docs late May + latest Stord report orders.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
const env = readFileSync('/Users/ryanbelanger/Projects/orchard-po-creator/.env.local', 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1]?.trim();
const db = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { autoRefreshToken: false, persistSession: false } });

// A. All ingested_documents created May 26 - Jun 1 (any type)
console.log('=== A. ALL ingested_documents (created May 26 – Jun 1) ===');
const { data: docs } = await db.schema('orchard').from('ingested_documents')
  .select('id, filename, document_type, status, created_at, parsed_data')
  .gte('created_at', '2026-05-26').lte('created_at', '2026-06-02').order('created_at');
for (const d of docs ?? []) {
  const p = d.parsed_data || {};
  console.log(`  ${d.created_at?.slice(0,16)} | ${d.document_type} | ${d.filename} | ${d.status}` + (p.dateRange ? ` | range ${p.dateRange.from}..${p.dateRange.to}` : '') + (p.error ? ` | ERR ${p.error.slice(0,80)}` : ''));
}

// B. Storage bucket "ingest" — top-level folders (one per email) + the May 27 email folder
console.log('\n=== B. STORAGE bucket "ingest" root ===');
const { data: root, error: re } = await db.storage.from('ingest').list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
if (re) console.log('ERR', re.message); else for (const f of root ?? []) console.log(`  ${f.created_at?.slice(0,16) ?? '-'} | ${f.name}`);

// C. The latest Stord report's 3 orders — what bronze receipts exist for them
console.log('\n=== C. LATEST STORD REPORT: the 3 skipped orders (bronze receipts, source=Stord, all dates) ===');
const { data: stordReceipts } = await db.schema('orchard').from('receipts')
  .select('receipt_number, received_date, external_id, created_at')
  .eq('source', 'Stord').order('received_date', { ascending: false }).limit(15);
for (const r of stordReceipts ?? []) console.log(`  ${r.received_date} | ${r.receipt_number} | ext=${r.external_id} | created=${r.created_at?.slice(0,16)}`);

// D. Re-parse the stored May 27 CSV to see the actual receipt dates / orders it contained
console.log('\n=== D. May 27 stored CSV — receipt-confirmation rows by date ===');
const { data: blob } = await db.storage.from('ingest').download('0ba8fc07-16a2-46f2-9e41-b29cd2fd7da2/Inventory Adjustments.csv');
if (blob) {
  const text = Buffer.from(await blob.arrayBuffer()).toString('utf-8');
  const lines = text.split(/\r?\n/);
  const parse = (l) => { const o=[];let c='';let q=false;for(let i=0;i<l.length;i++){const ch=l[i];if(q){if(ch==='"'&&l[i+1]==='"'){c+='"';i++;}else if(ch==='"')q=false;else c+=ch;}else{if(ch===',')
{o.push(c);c='';}else if(ch==='"')q=true;else c+=ch;}}o.push(c);return o;};
  const h = parse(lines[0]).map(s=>s.trim());
  const ix=(n)=>h.findIndex(x=>x.toLowerCase()===n.toLowerCase());
  const iD=ix('Adjustment Date'),iR=ix('Reason'),iRT=ix('Reason Type'),iC=ix('Inventory Category'),iO=ix('Order Number');
  const byDate={};
  for(let i=1;i<lines.length;i++){const r=parse(lines[i]);if(!r[iD])continue;if(r[iR]==='Receipt Confirmation'&&r[iRT]==='Receipt'&&r[iC]==='Receiving'){const d=r[iD].slice(0,10);(byDate[d]=byDate[d]||new Set()).add(r[iO]);}}
  for(const d of Object.keys(byDate).sort()) console.log(`  ${d}: orders ${[...byDate[d]].join(', ')}`);
} else console.log('  (could not download)');
console.log('\nDone.');
