import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  const [unmatched, reviewLines] = await Promise.all([
    getRecords(TABLES.RECEIPTS, {
      filterByFormula: `NOT({Purchase Order})`,
    }),
    getRecords(TABLES.RECEIPT_LINES, {
      filterByFormula: `{Match Status} = "Review"`,
    }),
  ]);

  return NextResponse.json({
    unmatched: unmatched.length,
    review: reviewLines.length,
  });
}
