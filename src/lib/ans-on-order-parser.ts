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
  sourceFilename: string | null; // original attachment filename, for bronze provenance
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

interface ColMap {
  so: number;
  itemId: number;
  description: number;
  salesQty: number;
  disposition: number;
  po: number;
  customerReq: number;
  estShip: number;
  notes: number;
}

/** Normalize a header cell: lowercase, collapse all whitespace (incl. \r\n). */
function normHeader(v: unknown): string {
  return String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Locate the header row and map each logical field to its column index by
 * matching header text. Falls back to the historical fixed indices if a header
 * can't be found, so older files still parse.
 */
function resolveColumns(grid: unknown[][]): { col: ColMap; headerRowIdx: number } {
  let headerRowIdx = grid.findIndex((r) =>
    (r || []).some((c) => {
      const h = normHeader(c);
      return h === "itemid" || h === "item id";
    })
  );
  if (headerRowIdx < 0) headerRowIdx = 3; // documented row 4 (index 3)

  const header = (grid[headerRowIdx] || []).map(normHeader);
  const find = (pred: (h: string) => boolean, fallback: number): number => {
    const idx = header.findIndex((h) => h !== "" && pred(h));
    return idx >= 0 ? idx : fallback;
  };

  const col: ColMap = {
    so: find((h) => h.includes("salesid") || h.includes("so#") || h === "so #", 0),
    itemId: find((h) => h === "itemid" || h === "item id", 2),
    description: find((h) => h.includes("description"), 3),
    salesQty: find((h) => h.includes("sales qty"), 4),
    disposition: find((h) => h.includes("dispos"), 10),
    po: find((h) => h === "po" || h === "customer po" || (h.includes("po") && h.includes("customer") && !h.includes("req")), 8),
    customerReq: find((h) => h.includes("customer req"), 14),
    estShip: find((h) => h.includes("est ship") || h.includes("ship ready") || h.includes("shipping date confirmed"), 15),
    notes: find((h) => h === "notes" || h.includes("notes"), 18),
  };
  return { col, headerRowIdx };
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

  // Resolve column positions BY HEADER NAME, not fixed index — ANS reformats
  // this sheet between versions (the 6/9/26 file shifted PO from col I→J, Est
  // Ship from P→L, Notes from S→O, etc.). Fixed indices silently mis-map.
  const { col, headerRowIdx } = resolveColumns(grid);

  // We carry forward the most recent SO# down each block until reset by a
  // blank row or a new SO#.
  let currentSo: string | null = null;
  const rows: AnsOnOrderRow[] = [];
  const malformed: AnsOnOrderReportResult["malformed"] = [];

  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const rowNumber = i + 1; // 1-indexed for human reference

    const soCell = cleanString(r[col.so]);
    const itemId = cleanString(r[col.itemId]);
    const customerPo = cleanString(r[col.po]);
    const noteCell = cleanString(r[col.notes]);

    // Skip blank rows; reset the SO# carry-forward
    if (!soCell && !itemId && !customerPo && !noteCell) {
      currentSo = null;
      continue;
    }

    // Skip repeated header rows (SO column "SO#"/"SALESID", or item col "ITEMID")
    if ((soCell && /^(SO#|SALESID)$/i.test(soCell)) || /^ITEMID$/i.test(itemId ?? "")) {
      currentSo = null;
      continue;
    }

    // New SO# starts a group
    if (soCell && /^SO\d+/i.test(soCell)) {
      currentSo = soCell.replace(/\s+/g, "");
    }

    // Footnote / orphan rows (notes only, no PO and no item)
    if (!itemId && !customerPo) {
      if (noteCell) {
        malformed.push({
          rowNumber,
          reason: "footnote_only",
          raw: [noteCell],
        });
      }
      continue;
    }

    // Rows with a Customer PO but missing ITEMID
    if (!itemId) {
      malformed.push({
        rowNumber,
        reason: "missing_itemid",
        raw: [customerPo, noteCell],
      });
      continue;
    }

    // Rows with ITEMID but no Customer PO (shouldn't happen, but guard)
    if (!customerPo) {
      malformed.push({
        rowNumber,
        reason: "missing_customer_po",
        raw: [itemId, noteCell],
      });
      continue;
    }

    rows.push({
      soNumber: currentSo,
      ansItemNumber: itemId,
      description: cleanString(r[col.description]),
      salesQty: parseSalesQty(r[col.salesQty]),
      customerPo,
      disposition: cleanString(r[col.disposition]),
      customerReqShipDate: parseDateCell(r[col.customerReq]),
      estShipReadyDate: parseDateCell(r[col.estShip]),
      notes: noteCell,
    });
  }

  const reportDate =
    (filename && extractReportDateFromFilename(filename)) ||
    fallbackDate ||
    new Date().toISOString().slice(0, 10);

  return { reportDate, sourceFilename: filename ?? null, rows, malformed };
}
