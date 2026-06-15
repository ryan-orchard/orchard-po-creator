import * as XLSX from "xlsx";

export interface StordAdjustmentRow {
  adjustmentDate: string;
  sku: string;
  reason: string;
  reasonType: string;
  inventoryCategory: string;
  valueBeforeAdjustment: number;
  adjustedQuantity: number;
  valueAfterAdjustment: number;
  unit: string;
  productName: string;
  brand: string;
  facility: string;
  orderNumber: string;
  lotNumber: string;
  expiresAt: string;
  notes: string;
}

export interface StordAdjustmentsReport {
  rows: StordAdjustmentRow[];
  dateRange: { from: string; to: string };
}

// Columns we must be able to locate to recognize a Stord adjustments report.
// We match by header NAME (not position), so Stord can rename peripheral
// columns or reorder them without breaking ingestion. The date column is
// matched fuzzily because Stord has shipped it as both "Adjustment Date" and
// "Adjustment UTC Date".
const ESSENTIAL_FIELDS: (keyof StordAdjustmentRow)[] = [
  "adjustmentDate",
  "sku",
  "reason",
  "reasonType",
  "inventoryCategory",
  "adjustedQuantity",
  "orderNumber",
];

function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Build a logical-field → column-index map from the header row.
 * Matching is by normalized header name so the parser is resilient to
 * Stord renaming or reordering columns. Returns -1 for any field not found.
 */
function buildColumnMap(headers: unknown[]): Record<keyof StordAdjustmentRow, number> {
  const norm = headers.map(normalizeHeader);
  const exact = (name: string) => norm.findIndex((h) => h === name);
  const fuzzy = (pred: (h: string) => boolean) => norm.findIndex(pred);

  // Date: "adjustment date", "adjustment utc date", or any header containing
  // both "adjustment" and "date"; fall back to a bare "date" column.
  let dateIdx = fuzzy((h) => h.includes("adjustment") && h.includes("date"));
  if (dateIdx < 0) dateIdx = exact("date");

  return {
    adjustmentDate: dateIdx,
    sku: exact("sku"),
    reason: exact("reason"),
    reasonType: exact("reason type"),
    inventoryCategory: exact("inventory category"),
    valueBeforeAdjustment: exact("value before adjustment"),
    adjustedQuantity: exact("adjusted quantity"),
    valueAfterAdjustment: exact("value after adjustment"),
    unit: exact("unit"),
    productName: exact("product name"),
    brand: exact("brand"),
    facility: exact("facility"),
    orderNumber: exact("order number"),
    lotNumber: exact("lot number"),
    expiresAt: exact("expires at"),
    notes: exact("notes"),
  };
}

function cell(row: unknown[], idx: number): unknown {
  return idx >= 0 ? row[idx] : undefined;
}

export function isStordAdjustmentsReport(
  subject: string,
  filename: string
): boolean {
  const lower = filename.toLowerCase();
  if (lower.includes("inventory") && lower.includes("adjustment")) return true;
  const subjectLower = subject.toLowerCase();
  if (
    subjectLower.includes("inventory") &&
    subjectLower.includes("adjustment")
  )
    return true;
  // Stord's "Previous Day Inbound Report" carries the same CSV schema and is a
  // legitimate receipt source on the days it has data.
  if (subjectLower.includes("inbound") && subjectLower.includes("report"))
    return true;
  return false;
}

/**
 * Parse the rows of a Stord adjustments report into structured objects.
 *
 * Resilient by design:
 *  - Columns are located by header name, not position (survives renames/reorder).
 *  - A header-only file (no data rows) returns [] instead of throwing, so the
 *    empty "Previous Day Inbound Report" is a clean no-op, not an inbox item.
 *  - Throws ONLY when the file does not look like a Stord adjustments report at
 *    all (essential columns absent) — a genuine "wrong file" signal.
 */
export function parseStordAdjustmentRows(buffer: Buffer): StordAdjustmentRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];

  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  if (rawRows.length === 0) return [];

  const colMap = buildColumnMap(rawRows[0]);

  const missing = ESSENTIAL_FIELDS.filter((f) => colMap[f] < 0);
  if (missing.length > 0) {
    throw new Error(
      `Not a Stord adjustments report — could not locate columns: ${missing.join(", ")}`
    );
  }

  const rows: StordAdjustmentRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;
    // Skip rows with no date AND no sku — blank/trailing rows.
    const dateCell = cell(row, colMap.adjustmentDate);
    const skuCell = cell(row, colMap.sku);
    if (dateCell == null && skuCell == null) continue;

    rows.push({
      adjustmentDate: String(dateCell ?? ""),
      sku: String(skuCell ?? ""),
      reason: String(cell(row, colMap.reason) ?? ""),
      reasonType: String(cell(row, colMap.reasonType) ?? ""),
      inventoryCategory: String(cell(row, colMap.inventoryCategory) ?? ""),
      valueBeforeAdjustment: Number(cell(row, colMap.valueBeforeAdjustment)) || 0,
      adjustedQuantity: Number(cell(row, colMap.adjustedQuantity)) || 0,
      valueAfterAdjustment: Number(cell(row, colMap.valueAfterAdjustment)) || 0,
      unit: String(cell(row, colMap.unit) ?? ""),
      productName: String(cell(row, colMap.productName) ?? ""),
      brand: String(cell(row, colMap.brand) ?? ""),
      facility: String(cell(row, colMap.facility) ?? ""),
      orderNumber: String(cell(row, colMap.orderNumber) ?? ""),
      lotNumber: String(cell(row, colMap.lotNumber) ?? ""),
      expiresAt: String(cell(row, colMap.expiresAt) ?? ""),
      notes: String(cell(row, colMap.notes) ?? ""),
    });
  }

  return rows;
}

export function parseStordAdjustmentsReport(
  buffer: Buffer
): StordAdjustmentsReport {
  const rows = parseStordAdjustmentRows(buffer);

  let minDate = "";
  let maxDate = "";
  for (const r of rows) {
    const d = r.adjustmentDate.slice(0, 10);
    if (!d) continue;
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  }

  return { rows, dateRange: { from: minDate, to: maxDate } };
}
