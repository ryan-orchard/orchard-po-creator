import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  const [openLines, blankLines, reviewLines] = await Promise.all([
    getRecords(TABLES.RECEIPT_LINES, {
      filterByFormula: `{Match Status} = "Open"`,
    }),
    getRecords(TABLES.RECEIPT_LINES, {
      filterByFormula: `{Match Status} = BLANK()`,
    }),
    getRecords(TABLES.RECEIPT_LINES, {
      filterByFormula: `{Match Status} = "Review"`,
    }),
  ]);

  return NextResponse.json({
    unmatched: openLines.length + blankLines.length,
    review: reviewLines.length,
  });
}
