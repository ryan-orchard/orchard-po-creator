import { getRecords, AirtableRecord } from "./airtable";

/**
 * Generate the next sequence number for a given table/prefix.
 * Pattern: PREFIX-10001, PREFIX-10002, ...
 */
export async function generateNextNumber(
  tableId: string,
  fieldName: string,
  prefix: string,
  startFrom = 10000
): Promise<string> {
  const records = await getRecords(tableId);
  const maxNum = getMaxSequenceNumber(records, fieldName, prefix, startFrom);
  return `${prefix}-${maxNum + 1}`;
}

/**
 * Get the current max sequence number from existing records.
 * Useful when you need to generate multiple numbers in a loop.
 */
export function getMaxSequenceNumber(
  records: AirtableRecord[],
  fieldName: string,
  prefix: string,
  startFrom = 10000
): number {
  let maxNum = startFrom;
  const regex = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of records) {
    const num = r.fields[fieldName] as string;
    const match = num?.match(regex);
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
  }
  return maxNum;
}
