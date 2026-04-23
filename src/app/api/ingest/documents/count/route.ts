import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

export async function GET() {
  const authError = await requireOperator();
  if (authError) return authError;
  const { count, error } = await db
    .schema("orchard")
    .from("ingested_documents")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ pending: count ?? 0 });
}
