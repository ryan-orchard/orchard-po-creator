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

function parseProductionData(ws: XLSX.WorkSheet): BmcTransactionRow[] {
  const rows: BmcTransactionRow[] = [];
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

  // Row 2 (0-indexed: 1) = headers, row 3+ = data
  for (let r = 2; r <= range.e.r; r++) {
    const entryType = String(ws[XLSX.utils.encode_cell({ r, c: 9 })]?.v ?? "").trim(); // Column J
    const itemNo = ws[XLSX.utils.encode_cell({ r, c: 5 })]?.v; // Column F

    // Skip rows with no item number
    if (!itemNo || typeof itemNo !== "string") continue;

    // Skip blank entry type rows (pallet status changes — noise)
    if (!entryType) continue;

    const entryNo = toNumber(ws[XLSX.utils.encode_cell({ r, c: 32 })]?.v); // Column AG
    if (!entryNo) continue; // Must have entry number for idempotency

    const postingDate = toDateString(ws[XLSX.utils.encode_cell({ r, c: 3 })]?.v); // Column D
    if (!postingDate) continue;

    rows.push({
      postingDate,
      bmcItemNo: itemNo.trim(),
      description: String(ws[XLSX.utils.encode_cell({ r, c: 6 })]?.v ?? "").trim(), // Column G
      standardSku: BMC_SKU_MAP[itemNo.trim()] ?? null,
      quantity: toNumber(ws[XLSX.utils.encode_cell({ r, c: 7 })]?.v), // Column H
      baseQuantity: toNumber(ws[XLSX.utils.encode_cell({ r, c: 8 })]?.v), // Column I
      entryType,
      uom: String(ws[XLSX.utils.encode_cell({ r, c: 10 })]?.v ?? "").trim(), // Column K
      externalDocNo: ws[XLSX.utils.encode_cell({ r, c: 11 })]?.v?.toString().trim() || null, // Column L
      lotNo: ws[XLSX.utils.encode_cell({ r, c: 12 })]?.v?.toString().trim() || null, // Column M
      documentNo: ws[XLSX.utils.encode_cell({ r, c: 15 })]?.v?.toString().trim() || null, // Column P
      prodOrderNo: ws[XLSX.utils.encode_cell({ r, c: 29 })]?.v?.toString().trim() || null, // Column AD
      orderNo: ws[XLSX.utils.encode_cell({ r, c: 30 })]?.v?.toString().trim() || null, // Column AE
      reasonCode: ws[XLSX.utils.encode_cell({ r, c: 20 })]?.v?.toString().trim() || null, // Column U
      reasonDesc: ws[XLSX.utils.encode_cell({ r, c: 21 })]?.v?.toString().trim() || null, // Column V
      entryNo,
      expirationDate: toDateString(ws[XLSX.utils.encode_cell({ r, c: 18 })]?.v), // Column S
      productionDate: toDateString(ws[XLSX.utils.encode_cell({ r, c: 31 })]?.v), // Column AF
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
