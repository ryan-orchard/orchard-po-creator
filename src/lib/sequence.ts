import { db } from "./supabase";

/**
 * Legacy helper — parse the max sequence number from an in-memory record array.
 * Used by routes not yet migrated to Supabase (e.g. stord webhook).
 */
export function getMaxSequenceNumber(
  records: Array<{ fields: Record<string, unknown> }>,
  fieldName: string,
  prefix: string,
  startFrom = 10000
): number {
  let maxNum = startFrom;
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of records) {
    const val = r.fields[fieldName] as string | undefined;
    const match = val?.match(regex);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return maxNum;
}

type SequencePrefix = "PO" | "WO" | "RCP" | "SH";

const SEQUENCE_MAP: Record<SequencePrefix, { schema: string; table: string; column: string }> = {
  PO:  { schema: "orchard", table: "purchase_orders", column: "po_number" },
  WO:  { schema: "orchard", table: "work_orders",     column: "wo_number" },
  RCP: { schema: "orchard", table: "receipts",        column: "receipt_number" },
  SH:  { schema: "orchard", table: "shipments",       column: "shipment_number" },
};

/**
 * Generate the next sequence number for a given prefix.
 * Pattern: PREFIX-10001, PREFIX-10002, ...
 *
 * Supports legacy 3-arg Airtable call form: generateNextNumber(tableId, fieldName, prefix)
 * The tableId and fieldName args are ignored — prefix (3rd arg) drives the lookup.
 */
export async function generateNextNumber(
  prefixOrTableId: string,
  _fieldName?: string,
  prefixArg?: string,
  startFrom = 10000
): Promise<string> {
  const prefix = (prefixArg ?? prefixOrTableId) as SequencePrefix;
  const seq = SEQUENCE_MAP[prefix];

  if (!seq) {
    throw new Error(`Unknown sequence prefix: ${prefix}`);
  }

  const { data, error } = await db
    .schema(seq.schema)
    .from(seq.table)
    .select(seq.column);

  if (error || !data) return `${prefix}-${startFrom + 1}`;

  // Numeric max — string ORDER BY would sort "PO-35" > "PO-10010".
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  let maxNum = startFrom;
  for (const row of data as unknown as Array<Record<string, string>>) {
    const match = row[seq.column]?.match(regex);
    if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
  }
  return `${prefix}-${maxNum + 1}`;
}
