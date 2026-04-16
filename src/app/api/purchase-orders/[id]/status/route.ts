import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status, soNumber } = await request.json();

  try {
    // Upsert status (row was seeded at PO creation; upsert handles any edge cases)
    const { error: statusError } = await db
      .schema("orchard_calcs")
      .from("po_statuses")
      .upsert(
        { po_id: id, status, updated_at: new Date().toISOString(), updated_by: "Ryan Belanger" },
        { onConflict: "po_id" }
      );

    if (statusError) {
      return NextResponse.json({ error: statusError.message }, { status: 500 });
    }

    // Write SO number separately so a field issue doesn't block the status save
    if (soNumber) {
      try {
        await db
          .schema("orchard")
          .from("purchase_orders")
          .update({ so_number: soNumber })
          .eq("id", id);
      } catch (soErr) {
        console.error("Failed to save SO number:", soErr);
        // Still return success — status was saved
      }
    }

    logActivity({
      poId: id,
      action: "status_changed",
      description: soNumber
        ? `Status changed to ${status} — ANS SO# ${soNumber}`
        : `Status changed to ${status}`,
      actor: "Ryan Belanger",
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
