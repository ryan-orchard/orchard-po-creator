/**
 * BMC Report Parser
 *
 * Parses the "Magna Month To Date Transaction and Inventory Stock Status Report"
 * Excel file from BMC (VisualPak). Two tabs:
 *   - "Inventory Summary" → on-hand snapshot
 *   - "Production Data" → transaction ledger (MTD)
 */
import * as XLSX from "xlsx";
import { BMC_SKU_MAP } from "./client-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BmcSnapshotRow {
  bmcItemNo: string;
  description: string;
  standardSku: string | null;
  qtyOnHand: number;
  qtyOnHold: number;
  qtyAvailable: number;
  baseUom: string;
  palletCount: number;
}

export interface BmcTransactionRow {
  postingDate: string; // YYYY-MM-DD
  bmcItemNo: string;
  description: string;
  standardSku: string | null;
  quantity: number;
  baseQuantity: number;
  entryType: string;
  uom: string;
  externalDocNo: string | null;
  lotNo: string | null;
  documentNo: string | null;
  prodOrderNo: string | null;
  orderNo: string | null;
  reasonCode: string | null;
  reasonDesc: string | null;
  entryNo: number;
  expirationDate: string | null; // YYYY-MM-DD
  productionDate: string | null; // YYYY-MM-DD
}

export interface BmcReportResult {
  snapshot: BmcSnapshotRow[];
  transactions: BmcTransactionRow[];
  unmapped: string[]; // BMC item numbers with no standard SKU
  reportDate: string; // YYYY-MM-DD (latest posting date in transactions)
  snapshotItemCount: number;
  transactionCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateString(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === "number") {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (d) {
      const mm = String(d.m).padStart(2, "0");
      const dd = String(d.d).padStart(2, "0");
      return `${d.y}-${mm}-${dd}`;
    }
  }
  if (typeof val === "string") {
    const parsed = new Date(val);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function toNumber(val: unknown): number {
  if (val == null) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const cleaned = val.replace(/,/g, "").trim();
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseInventorySummary(ws: XLSX.WorkSheet): BmcSnapshotRow[] {
  const rows: BmcSnapshotRow[] = [];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

  // Row 3 (0-indexed: 2) = headers, row 4+ = data
  for (let r = 3; r <= range.e.r; r++) {
    const itemNo = ws[XLSX.utils.encode_cell({ r, c: 2 })]?.v; // Column C
    if (!itemNo || typeof itemNo !== "string") continue;

    const description = ws[XLSX.utils.encode_cell({ r, c: 4 })]?.v ?? ""; // Column E
    const qtyOnHand = toNumber(ws[XLSX.utils.encode_cell({ r, c: 5 })]?.v); // Column F
    const qtyOnHold = toNumber(ws[XLSX.utils.encode_cell({ r, c: 6 })]?.v); // Column G
    const baseUom = ws[XLSX.utils.encode_cell({ r, c: 7 })]?.v ?? ""; // Column H
    const qtyAvailable = toNumber(ws[XLSX.utils.encode_cell({ r, c: 11 })]?.v); // Column L
    const palletCount = toNumber(ws[XLSX.utils.encode_cell({ r, c: 13 })]?.v); // Column N

    rows.push({
      bmcItemNo: itemNo.trim(),
      description: String(description).trim(),
      standardSku: BMC_SKU_MAP[itemNo.trim()] ?? null,
      qtyOnHand,
      qtyOnHold,
      qtyAvailable,
      baseUom: String(baseUom).trim(),
      palletCount,
    });
  }

  return rows;
}

// Build a header-name → column-index map from a header row.
// BMC has shipped column shuffles before (Apr 2026: one column inserted before
// "Prod. Order No.", silently shifting AD-AG right). Looking up by name beats
// hardcoding positions.
function buildHeaderMap(ws: XLSX.WorkSheet, headerRow0Idx: number): Map<string, number> {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  const map = new Map<string, number>();
  for (let c = 0; c <= range.e.c; c++) {
    const v = ws[XLSX.utils.encode_cell({ r: headerRow0Idx, c })]?.v;
    if (typeof v === "string") {
      const key = v.trim().toLowerCase();
      if (key) map.set(key, c);
    }
  }
  return map;
}

function parseProductionData(ws: XLSX.WorkSheet): BmcTransactionRow[] {
  const rows: BmcTransactionRow[] = [];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

  // Row 2 (0-indexed: 1) = headers, row 3+ = data
  const headers = buildHeaderMap(ws, 1);
  const col = (name: string): number => {
    const idx = headers.get(name.toLowerCase());
    if (idx === undefined) {
      throw new Error(`BMC Production Data missing column "${name}"`);
    }
    return idx;
  };

  const cPostingDate    = col("Posting Date");
  const cItemNo         = col("Item No.");
  const cDescription    = col("Description");
  const cQty            = col("Quantity");
  const cBaseQty        = col("Quantity(Base)");
  const cEntryType      = col("Entry Type");
  const cUom            = col("Unit of Measure Code");
  const cExternalDoc    = col("External Document No.");
  const cLotNo          = col("Lot No.");
  const cDocNo          = col("Document No.");
  const cExpDate        = col("Expiration Date");
  const cReasonCode     = col("Reason Code");
  const cReasonDesc     = col("Reason Code Desc.");
  const cProdOrderNo    = col("Prod. Order No.");
  const cOrderNo        = col("Order No.");
  const cProductionDate = col("Production Date");
  const cEntryNo        = col("Entry No.");

  for (let r = 2; r <= range.e.r; r++) {
    const entryType = String(ws[XLSX.utils.encode_cell({ r, c: cEntryType })]?.v ?? "").trim();
    const itemNo = ws[XLSX.utils.encode_cell({ r, c: cItemNo })]?.v;

    if (!itemNo || typeof itemNo !== "string") continue;
    if (!entryType) continue;

    const entryNo = toNumber(ws[XLSX.utils.encode_cell({ r, c: cEntryNo })]?.v);
    if (!entryNo) continue;

    const postingDate = toDateString(ws[XLSX.utils.encode_cell({ r, c: cPostingDate })]?.v);
    if (!postingDate) continue;

    rows.push({
      postingDate,
      bmcItemNo: itemNo.trim(),
      description: String(ws[XLSX.utils.encode_cell({ r, c: cDescription })]?.v ?? "").trim(),
      standardSku: BMC_SKU_MAP[itemNo.trim()] ?? null,
      quantity: toNumber(ws[XLSX.utils.encode_cell({ r, c: cQty })]?.v),
      baseQuantity: toNumber(ws[XLSX.utils.encode_cell({ r, c: cBaseQty })]?.v),
      entryType,
      uom: String(ws[XLSX.utils.encode_cell({ r, c: cUom })]?.v ?? "").trim(),
      externalDocNo: ws[XLSX.utils.encode_cell({ r, c: cExternalDoc })]?.v?.toString().trim() || null,
      lotNo: ws[XLSX.utils.encode_cell({ r, c: cLotNo })]?.v?.toString().trim() || null,
      documentNo: ws[XLSX.utils.encode_cell({ r, c: cDocNo })]?.v?.toString().trim() || null,
      prodOrderNo: ws[XLSX.utils.encode_cell({ r, c: cProdOrderNo })]?.v?.toString().trim() || null,
      orderNo: ws[XLSX.utils.encode_cell({ r, c: cOrderNo })]?.v?.toString().trim() || null,
      reasonCode: ws[XLSX.utils.encode_cell({ r, c: cReasonCode })]?.v?.toString().trim() || null,
      reasonDesc: ws[XLSX.utils.encode_cell({ r, c: cReasonDesc })]?.v?.toString().trim() || null,
      entryNo,
      expirationDate: toDateString(ws[XLSX.utils.encode_cell({ r, c: cExpDate })]?.v),
      productionDate: toDateString(ws[XLSX.utils.encode_cell({ r, c: cProductionDate })]?.v),
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function parseBmcReport(buffer: Buffer): BmcReportResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  const inventorySheet = wb.Sheets["Inventory Summary"];
  const productionSheet = wb.Sheets["Production Data"];

  if (!inventorySheet) {
    throw new Error('BMC report missing "Inventory Summary" tab');
  }
  if (!productionSheet) {
    throw new Error('BMC report missing "Production Data" tab');
  }

  const snapshot = parseInventorySummary(inventorySheet);
  const transactions = parseProductionData(productionSheet);

  // Collect unmapped items
  const unmappedSet = new Set<string>();
  for (const row of snapshot) {
    if (!row.standardSku) unmappedSet.add(row.bmcItemNo);
  }
  for (const row of transactions) {
    if (!row.standardSku) unmappedSet.add(row.bmcItemNo);
  }

  // Determine report date from the latest posting date
  let reportDate = new Date().toISOString().slice(0, 10);
  if (transactions.length > 0) {
    reportDate = transactions.reduce((latest, t) =>
      t.postingDate > latest ? t.postingDate : latest,
      transactions[0].postingDate
    );
  }

  return {
    snapshot,
    transactions,
    unmapped: Array.from(unmappedSet),
    reportDate,
    snapshotItemCount: snapshot.length,
    transactionCount: transactions.length,
  };
}

/**
 * Detect whether an email attachment is a BMC daily report.
 * Checks subject line and/or filename.
 */
export function isBmcReport(subject: string, filename: string): boolean {
  const subjectLower = subject.toLowerCase();
  const filenameLower = filename.toLowerCase();

  // Subject line detection
  if (subjectLower.includes("magna") && subjectLower.includes("transaction")) {
    return true;
  }

  // Filename detection
  if (
    filenameLower.includes("magna") &&
    filenameLower.includes("transaction") &&
    (filenameLower.endsWith(".xlsx") || filenameLower.endsWith(".xls"))
  ) {
    return true;
  }

  return false;
}
