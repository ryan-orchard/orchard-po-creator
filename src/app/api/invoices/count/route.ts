import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const { count } = await db
    .schema("orchard")
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("match_status", "Open");

  return NextResponse.json({ unmatched: count ?? 0 });
}
