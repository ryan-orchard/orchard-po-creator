import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  const [openLines, blankLines, reviewLines] = await Promise.all([
    getRecords(TABLES.RECEIPT_LINES, {
      filterByFormula: `{Status} = "Open"`,
    }),
    getRecords(TABLES.RECEIPT_LINES, {
      filterByFormula: `{Status} = BLANK()`,
    }),
    getRecords(TABLES.RECEIPT_LINES, {
      filterByFormula: `{Status} = "Review"`,
    }),
  ]);

  return NextResponse.json({
    unmatched: openLines.length + blankLines.length,
    review: reviewLines.length,
  });
}
