import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const [unmatchedResult, reviewResult] = await Promise.all([
    db.schema("orchard_calcs").from("receipt_line_statuses").select("receipt_line_id", { count: "exact", head: true })
      .eq("transfer_status", "unmatched").is("flag", null),
    db.schema("orchard_calcs").from("receipt_line_statuses").select("receipt_line_id", { count: "exact", head: true })
      .eq("flag", "review"),
  ]);

  return NextResponse.json({
    unmatched: unmatchedResult.count ?? 0,
    review: reviewResult.count ?? 0,
  });
}
