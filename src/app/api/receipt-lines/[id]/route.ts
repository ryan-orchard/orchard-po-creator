import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { setReceiptLineStatus, type ReceiptLineStatus } from "@/lib/receipt-status";

/**
 * PATCH /api/receipt-lines/[id]
 *
 * Update a receipt line. Supports:
 * - { skuId: string } — Update item link (Silver line item_id)
 * - { matchStatus: "Open" | "Matched" | "Excluded" | "Review" } — Update Silver status
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

    let didSomething = false;

    if (body.skuId !== undefined) {
      if (!body.skuId) return NextResponse.json({ error: "skuId cannot be empty" }, { status: 400 });
      const { error } = await db
        .schema("orchard_calcs")
        .from("receipt_lines")
        .update({ item_id: body.skuId })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      didSomething = true;
    }

    if (body.matchStatus !== undefined) {
      const valid = ["Open", "Matched", "Excluded", "Review"];
      if (!valid.includes(body.matchStatus)) {
        return NextResponse.json({ error: `matchStatus must be one of: ${valid.join(", ")}` }, { status: 400 });
      }
      const { error } = await setReceiptLineStatus(id, body.matchStatus as ReceiptLineStatus, "Ryan Belanger");
      if (error) return NextResponse.json({ error: (error as { message?: string }).message ?? "status update failed" }, { status: 500 });
      didSomething = true;
    }

    if (!didSomething) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to update: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
