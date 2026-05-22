import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

// POST /api/transfers/[id]/cancel — cancel a transfer and reverse its movements.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;
  const now = new Date().toISOString();

  const { error } = await db
    .schema("orchard")
    .from("transfers")
    .update({ status: "cancelled", updated_at: now })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Reverse the projected movements for this transfer's lines.
  const { data: lines } = await db
    .schema("orchard")
    .from("transfer_lines")
    .select("id")
    .eq("transfer_id", id);
  const lineIds = (lines ?? []).map((l) => l.id as string);

  if (lineIds.length > 0) {
    await db
      .schema("orchard_calcs")
      .from("movements")
      .update({ state: "reversed", updated_at: now })
      .eq("source_doc_type", "transfer_line")
      .in("source_doc_id", lineIds);
  }

  return NextResponse.json({ success: true, id });
}
