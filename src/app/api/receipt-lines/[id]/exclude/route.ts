import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

/**
 * POST /api/receipt-lines/[id]/exclude
 *
 * Sets a receipt line status to Excluded.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const { id } = await params;

    const { error } = await db
      .schema("orchard")
      .from("receipt_lines")
      .update({ status: "Excluded" })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to exclude: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
