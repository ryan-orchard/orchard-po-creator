import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

export async function GET() {
  const unmatched = await getRecords(TABLES.INVOICES, {
    filterByFormula: `NOT({Purchase Order})`,
  });

  return NextResponse.json({ unmatched: unmatched.length });
}
