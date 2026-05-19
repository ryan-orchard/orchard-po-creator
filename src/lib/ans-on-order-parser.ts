/**
 * ANS On Order Report parser.
 *
 * Source: weekly Excel sent by ANS to magna@orchardinventory.com.
 * Filename pattern: "OpenSalesOrdersSummary- MAGNA<M.D.YY>.xlsx" (spaces vary).
 *
 * Single sheet. Headers on row 4 (1-indexed). Sections separated by blank
 * rows and occasional repeated header rows. Trailing footnote rows have
 * only the Notes column populated.
 *
 * Column map (1-indexed → array index):
 *   A  0  SO#                     — only on first row of each SO group
 *   C  2  ITEMID                  → org_config.items.ans_item_number
 *   D  3  DESCRIPTION
 *   E  4  Sales Qty               — formatted as "$20,000.000"
 *   F  5  Sales Price
 *   I  8  Customer PO             → 'PO-' || value joins purchase_orders.po_number
 *   K 10  ANS Batch Disposition   — QAHOLD / QAREVIEW / RLSTOPKG / ...
 *   M 12  Lot Quantity
 *   O 14  Customer Req. Ship Date
 *   P 15  Est Ship Ready Date     — sometimes "Shipping Date Confirmed" in repeated headers
 *   S 18  Notes
 */
import * as XLSX from "xlsx";

export interface AnsOnOrderRow {
  soNumber: string | null;
  ansItemNumber: string;
  description: string | null;
  salesQty: number | null;
  customerPo: string;
  disposition: string | null;
  customerReqShipDate: string | null; // YYYY-MM-DD
  estShipReadyDate: string | null; // YYYY-MM-DD
  notes: string | null;
}

export interface AnsOnOrderReportResult {
  reportDate: string; // YYYY-MM-DD
  rows: AnsOnOrderRow[];
  /** Rows present in the file that we couldn't extract a usable record from
   * (e.g., Customer PO present but no ITEMID, or footnote-only rows with notes). */
  malformed: { rowNumber: number; reason: string; raw: unknown[] }[];
}

const FILENAME_RE = /OpenSalesOrdersSummary/i;

export function isAnsOnOrderReport(subject: string, filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    FILENAME_RE.test(filename) &&
    (lower.endsWith(".xlsx") || lower.endsWith(".xls"))
  );
}

/**
 * Extract the report date from a filename like "OpenSalesOrdersSummary- MAGNA5.18.26.xlsx"
 * or "OpenSalesOrdersSummary- MAGNA 5.18.26 (1).xlsx". Returns YYYY-MM-DD or null.
 */
export function extractReportDateFromFilename(filename: string): string | null {
  // Match M.D.YY or MM.DD.YY anywhere after MAGNA
  const m = filename.match(/MAGNA\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseSalesQty(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseDateCell(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  // ANS uses "TBD", "Completed", "NA", "Pending", etc. for non-dates
  if (!/^\d/.test(s)) return null;
  // M/D/YY or MM/DD/YY (rarely with 4-digit year)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function cleanString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/\r/g, "").trim();
  return s || null;
}

export function parseAnsOnOrderReport(
  buffer: Buffer,
  filename?: string,
  fallbackDate?: string
): AnsOnOrderReportResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("ANS On Order report has no sheets");
  }
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: false,
  });

  // Data starts after the header row (row 4 in 1-indexed terms → index 3).
  // We carry forward the most recent SO# down each block until reset by a
  // blank row or a new SO#.
  let currentSo: string | null = null;
  const rows: AnsOnOrderRow[] = [];
  const malformed: AnsOnOrderReportResult["malformed"] = [];

  for (let i = 4; i < grid.length; i++) {
    const r = grid[i] || [];
    const rowNumber = i + 1; // 1-indexed for human reference

    const soCell = cleanString(r[0]);
    const itemId = cleanString(r[2]);
    const customerPo = cleanString(r[8]);

    // Skip blank rows; reset the SO# carry-forward
    if (!soCell && !itemId && !customerPo && !cleanString(r[18])) {
      currentSo = null;
      continue;
    }

    // Skip repeated header rows (column A literally "SO#")
    if (soCell && /^SO#$/i.test(soCell)) {
      currentSo = null;
      continue;
    }

    // New SO# starts a group
    if (soCell && /^SO\d+/i.test(soCell)) {
      currentSo = soCell.replace(/\s+/g, "");
    }

    // Footnote / orphan rows (notes only, no PO and no item)
    if (!itemId && !customerPo) {
      const note = cleanString(r[18]);
      if (note) {
        malformed.push({
          rowNumber,
          reason: "footnote_only",
          raw: [note],
        });
      }
      continue;
    }

    // Rows with a Customer PO but missing ITEMID
    if (!itemId) {
      malformed.push({
        rowNumber,
        reason: "missing_itemid",
        raw: [customerPo, cleanString(r[18])],
      });
      continue;
    }

    // Rows with ITEMID but no Customer PO (shouldn't happen, but guard)
    if (!customerPo) {
      malformed.push({
        rowNumber,
        reason: "missing_customer_po",
        raw: [itemId, cleanString(r[18])],
      });
      continue;
    }

    rows.push({
      soNumber: currentSo,
      ansItemNumber: itemId,
      description: cleanString(r[3]),
      salesQty: parseSalesQty(r[4]),
      customerPo,
      disposition: cleanString(r[10]),
      customerReqShipDate: parseDateCell(r[14]),
      estShipReadyDate: parseDateCell(r[15]),
      notes: cleanString(r[18]),
    });
  }

  const reportDate =
    (filename && extractReportDateFromFilename(filename)) ||
    fallbackDate ||
    new Date().toISOString().slice(0, 10);

  return { reportDate, rows, malformed };
}
