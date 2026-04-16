import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

/**
 * PATCH /api/receipt-lines/[id]
 *
 * Update a receipt line. Supports:
 * - { skuId: string } — Update item link
 * - { matchStatus: "Open" | "Matched" | "Excluded" | "Review" } — Update status
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  try {
    const { id } = await params;
    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.skuId !== undefined) {
      if (!body.skuId) return NextResponse.json({ error: "skuId cannot be empty" }, { status: 400 });
      updates.item_id = body.skuId;
    }

    if (body.matchStatus !== undefined) {
      const valid = ["Open", "Matched", "Excluded", "Review"];
      if (!valid.includes(body.matchStatus)) {
        return NextResponse.json({ error: `matchStatus must be one of: ${valid.join(", ")}` }, { status: 400 });
      }
      updates.status = body.matchStatus;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { error } = await db.schema("orchard").from("receipt_lines").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to update: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
