import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const { count } = await db
    .schema("orchard_calcs")
    .from("invoice_statuses")
    .select("invoice_id", { count: "exact", head: true })
    .eq("match_status", "unmatched");

  return NextResponse.json({ unmatched: count ?? 0 });
}
