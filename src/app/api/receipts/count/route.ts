import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const [openResult, reviewResult] = await Promise.all([
    db.schema("orchard_calcs").from("receipt_line_statuses").select("receipt_line_id", { count: "exact", head: true }).eq("status", "Open"),
    db.schema("orchard_calcs").from("receipt_line_statuses").select("receipt_line_id", { count: "exact", head: true }).eq("status", "Review"),
  ]);

  return NextResponse.json({
    unmatched: openResult.count ?? 0,
    review: reviewResult.count ?? 0,
  });
}
