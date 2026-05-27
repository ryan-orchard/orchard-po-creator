import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";

// PATCH /api/purchase-orders/[id]/status
// Sets every (non-cancelled) line of the PO to 'ordered' or 'confirmed'.
// 'complete' is not handled here — it goes through
// POST /api/po-lines/[id]/complete, which also posts the Acquisition movement.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;
  const { state, soNumber } = await request.json();

  if (state !== "ordered" && state !== "confirmed") {
    return NextResponse.json(
      { error: "state must be 'ordered' or 'confirmed'" },
      { status: 400 }
    );
  }

  const { data: lines } = await db
    .schema("orchard")
    .from("po_lines")
    .select("id")
    .eq("po_id", id);
  const lineIds = (lines ?? []).map((l) => l.id as string);

  // Don't disturb lines that have been cancelled.
  const { data: existing } = lineIds.length
    ? await db
        .schema("orchard_calcs")
        .from("po_line_statuses")
        .select("po_line_id, state")
        .in("po_line_id", lineIds)
    : { data: [] };
  const cancelled = new Set(
    (existing ?? [])
      .filter((s) => s.state === "cancelled")
      .map((s) => s.po_line_id as string)
  );

  const now = new Date().toISOString();
  const rows = lineIds
    .filter((lid) => !cancelled.has(lid))
    .map((lid) => ({
      po_line_id: lid,
      state,
      updated_at: now,
      updated_by: "Ryan Belanger",
    }));

  if (rows.length > 0) {
    const { error } = await db
      .schema("orchard_calcs")
      .from("po_line_statuses")
      .upsert(rows, { onConflict: "po_line_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (soNumber) {
    await db
      .schema("orchard")
      .from("purchase_orders")
      .update({ so_number: soNumber })
      .eq("id", id);
  }

  logActivity({
    poId: id,
    action: "status_changed",
    description: soNumber
      ? `Status set to ${state} — SO# ${soNumber}`
      : `Status set to ${state}`,
    actor: "Ryan Belanger",
  });

  return NextResponse.json({ success: true });
}
