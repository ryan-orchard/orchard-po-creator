/**
 * Test script: parse the sample BMC report and write to Supabase.
 * Usage: node --env-file=.env.local scripts/test-bmc-ingest.mjs
 */
import fs from "fs";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BMC_SKU_MAP = {
  SINAJU0101: "ELEC-APPLEJUICE-STICK", SINBLO0101: "ELEC-BLOODORANGE-STICK",
  SINLML0101: "ELEC-LEMONLIME-STICK", SINTLM0101: "ELEC-TEALEMONADE-STICK",
  SINWML0101: "ELEC-WATERMELONLIME-STICK",
  PKGAJU1001: "PKG-APPLEJUICE-10", PKGBLO1001: "PKG-BLOODORANGE-10",
  PKGLML1001: "PKG-LEMONLIME-10", PKGTLM1001: "PKG-TEALEMONADE-10",
  PKGWML1001: "PKG-WATERMELONLIME-10", PKGWAF1001: "PKG-WAFERSEAL",
  PKGMCP1001: "PKG-MASTERCASE",
  MAGAJU1001: "ELEC-APPLEJUICE-60", MAGBLO1001: "ELEC-BLOODORANGE-60",
  MAGLML1001: "ELEC-LEMONLIME-60", MAGTLM1001: "ELEC-TEALEMONADE-60",
  MAGWML1001: "ELEC-WATERMELONLIME-60",
};

function toNumber(v) { if (v == null) return 0; if (typeof v === "number") return v; const n = Number(String(v).replace(/,/g, "").trim()); return isNaN(n) ? 0 : n; }
function toDateStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") { const d = XLSX.SSF.parse_date_code(v); if (d) return d.y + "-" + String(d.m).padStart(2, "0") + "-" + String(d.d).padStart(2, "0"); }
  return null;
}

const filePath = "/Users/ryanbelanger/Claude Agent/Orchard-Inventory-Tool/docs/Magna Month To Date Transaction and Inventory Stock Status Report.xlsx";
const buffer = fs.readFileSync(filePath);
const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

// Parse Inventory Summary
const ws = wb.Sheets["Inventory Summary"];
const range = XLSX.utils.decode_range(ws["!ref"]);
const snapRows = [];
for (let r = 3; r <= range.e.r; r++) {
  const itemNo = ws[XLSX.utils.encode_cell({ r, c: 2 })]?.v;
  if (!itemNo || typeof itemNo !== "string") continue;
  snapRows.push({
    bmcItemNo: itemNo.trim(),
    standardSku: BMC_SKU_MAP[itemNo.trim()] || null,
    qtyOnHand: toNumber(ws[XLSX.utils.encode_cell({ r, c: 5 })]?.v),
    qtyOnHold: toNumber(ws[XLSX.utils.encode_cell({ r, c: 6 })]?.v),
    qtyAvailable: toNumber(ws[XLSX.utils.encode_cell({ r, c: 11 })]?.v),
    baseUom: String(ws[XLSX.utils.encode_cell({ r, c: 7 })]?.v || "").trim(),
    palletCount: toNumber(ws[XLSX.utils.encode_cell({ r, c: 13 })]?.v),
  });
}

// Parse Production Data
const ws2 = wb.Sheets["Production Data"];
const range2 = XLSX.utils.decode_range(ws2["!ref"]);
const txnRows = [];
for (let r = 2; r <= range2.e.r; r++) {
  const et = String(ws2[XLSX.utils.encode_cell({ r, c: 9 })]?.v || "").trim();
  const itemNo = ws2[XLSX.utils.encode_cell({ r, c: 5 })]?.v;
  if (!itemNo || typeof itemNo !== "string" || !et) continue;
  const entryNo = toNumber(ws2[XLSX.utils.encode_cell({ r, c: 32 })]?.v);
  const postingDate = toDateStr(ws2[XLSX.utils.encode_cell({ r, c: 3 })]?.v);
  if (!entryNo || !postingDate) continue;
  txnRows.push({
    postingDate, bmcItemNo: itemNo.trim(), standardSku: BMC_SKU_MAP[itemNo.trim()] || null,
    description: String(ws2[XLSX.utils.encode_cell({ r, c: 6 })]?.v || "").trim(),
    quantity: toNumber(ws2[XLSX.utils.encode_cell({ r, c: 7 })]?.v),
    baseQuantity: toNumber(ws2[XLSX.utils.encode_cell({ r, c: 8 })]?.v),
    entryType: et, uom: String(ws2[XLSX.utils.encode_cell({ r, c: 10 })]?.v || "").trim(),
    externalDocNo: ws2[XLSX.utils.encode_cell({ r, c: 11 })]?.v?.toString().trim() || null,
    lotNo: ws2[XLSX.utils.encode_cell({ r, c: 12 })]?.v?.toString().trim() || null,
    documentNo: ws2[XLSX.utils.encode_cell({ r, c: 15 })]?.v?.toString().trim() || null,
    prodOrderNo: ws2[XLSX.utils.encode_cell({ r, c: 29 })]?.v?.toString().trim() || null,
    orderNo: ws2[XLSX.utils.encode_cell({ r, c: 30 })]?.v?.toString().trim() || null,
    reasonCode: ws2[XLSX.utils.encode_cell({ r, c: 20 })]?.v?.toString().trim() || null,
    reasonDesc: ws2[XLSX.utils.encode_cell({ r, c: 21 })]?.v?.toString().trim() || null,
    entryNo,
    expirationDate: toDateStr(ws2[XLSX.utils.encode_cell({ r, c: 18 })]?.v),
    productionDate: toDateStr(ws2[XLSX.utils.encode_cell({ r, c: 31 })]?.v),
  });
}

const reportDate = txnRows.reduce((l, t) => t.postingDate > l ? t.postingDate : l, txnRows[0]?.postingDate || new Date().toISOString().slice(0, 10));
console.log("Parsed:", snapRows.length, "snapshot items,", txnRows.length, "transactions, reportDate:", reportDate);

// Resolve item IDs
const allSkus = [...new Set([...snapRows.map(s => s.standardSku), ...txnRows.map(t => t.standardSku)].filter(Boolean))];
const { data: items } = await db.schema("org_config").from("items").select("id, sku").in("sku", allSkus);
const itemIdMap = new Map((items || []).map(i => [i.sku, i.id]));
console.log("Resolved", itemIdMap.size, "/", allSkus.length, "SKUs to item IDs");
const missing = allSkus.filter(s => !itemIdMap.has(s));
if (missing.length) console.log("Missing SKUs:", missing);

// Write snapshots
await db.schema("orchard").from("inventory_snapshots").delete().eq("warehouse_code", "BMC").eq("snapshot_date", reportDate);
const snapInsert = snapRows.map(r => ({
  client_id: "magna", warehouse_code: "BMC", snapshot_date: reportDate,
  item_id: r.standardSku ? itemIdMap.get(r.standardSku) || null : null,
  sku: r.standardSku || r.bmcItemNo, qty_on_hand: r.qtyOnHand, qty_on_hold: r.qtyOnHold,
  qty_available: r.qtyAvailable, base_uom: r.baseUom, pallet_count: r.palletCount,
}));
const { error: snapErr } = await db.schema("orchard").from("inventory_snapshots").insert(snapInsert);
if (snapErr) { console.error("SNAPSHOT ERROR:", snapErr); process.exit(1); }
console.log("✓ Wrote", snapInsert.length, "snapshot rows");

// Write transactions
const txnInsert = txnRows.map(r => ({
  client_id: "magna", posting_date: r.postingDate,
  item_id: r.standardSku ? itemIdMap.get(r.standardSku) || null : null,
  bmc_item_no: r.bmcItemNo, description: r.description,
  quantity: r.quantity, base_quantity: r.baseQuantity,
  entry_type: r.entryType, uom: r.uom,
  external_doc_no: r.externalDocNo, lot_no: r.lotNo,
  document_no: r.documentNo, prod_order_no: r.prodOrderNo,
  order_no: r.orderNo, reason_code: r.reasonCode,
  reason_desc: r.reasonDesc, entry_no: r.entryNo,
  expiration_date: r.expirationDate, production_date: r.productionDate,
  report_date: reportDate,
}));

let newTxns = 0;
for (let i = 0; i < txnInsert.length; i += 100) {
  const batch = txnInsert.slice(i, i + 100);
  const { data, error } = await db.schema("orchard").from("bmc_transactions")
    .upsert(batch, { onConflict: "entry_no", ignoreDuplicates: true }).select("id");
  if (error) { console.error("TXN ERROR at batch", i, ":", error); process.exit(1); }
  newTxns += (data?.length || 0);
}
console.log("✓ Wrote", newTxns, "new transactions (", txnRows.length - newTxns, "duplicates skipped)");

// Verify
const { data: verify } = await db.schema("orchard").from("inventory_snapshots")
  .select("sku, qty_on_hand, qty_on_hold, qty_available, base_uom, pallet_count")
  .eq("warehouse_code", "BMC").eq("snapshot_date", reportDate)
  .order("sku");

console.log("\n=== BMC Snapshot (" + reportDate + ") ===");
for (const r of verify || []) {
  console.log(" ", r.sku, "| OH:", r.qty_on_hand, "Hold:", r.qty_on_hold, "Avail:", r.qty_available, "UOM:", r.base_uom, "Pallets:", r.pallet_count);
}

const { count } = await db.schema("orchard").from("bmc_transactions").select("id", { count: "exact", head: true });
console.log("\nTotal transactions in bmc_transactions:", count);
console.log("\n✓ Done — first BMC snapshot captured!");
