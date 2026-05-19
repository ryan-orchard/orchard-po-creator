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

const EXPECTED_HEADERS = [
  "Adjustment Date",
  "SKU",
  "Reason",
  "Reason Type",
  "Inventory Category",
];

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
  return false;
}

export function parseStordAdjustmentsReport(
  buffer: Buffer
): StordAdjustmentsReport {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
  }) as unknown[][];

  if (rawRows.length < 2) {
    throw new Error("Stord adjustments report is empty or has no data rows");
  }

  const headers = rawRows[0] as string[];
  const missing = EXPECTED_HEADERS.filter(
    (h) => !headers.some((hdr) => hdr?.trim().toLowerCase() === h.toLowerCase())
  );
  if (missing.length > 0) {
    throw new Error(
      `Not a Stord adjustments report — missing columns: ${missing.join(", ")}`
    );
  }

  const rows: StordAdjustmentRow[] = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0 || row[0] == null) continue;

    rows.push({
      adjustmentDate: String(row[0] ?? ""),
      sku: String(row[1] ?? ""),
      reason: String(row[2] ?? ""),
      reasonType: String(row[3] ?? ""),
      inventoryCategory: String(row[4] ?? ""),
      valueBeforeAdjustment: Number(row[5]) || 0,
      adjustedQuantity: Number(row[6]) || 0,
      valueAfterAdjustment: Number(row[7]) || 0,
      unit: String(row[8] ?? ""),
      productName: String(row[9] ?? ""),
      brand: String(row[10] ?? ""),
      facility: String(row[11] ?? ""),
      orderNumber: String(row[12] ?? ""),
      lotNumber: String(row[13] ?? ""),
      expiresAt: String(row[14] ?? ""),
      notes: String(row[15] ?? ""),
    });
  }

  let minDate = "";
  let maxDate = "";
  for (const r of rows) {
    const d = r.adjustmentDate.slice(0, 10);
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  }

  return { rows, dateRange: { from: minDate, to: maxDate } };
}
