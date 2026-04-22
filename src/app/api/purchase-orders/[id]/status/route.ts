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
    // Build milestone timestamp updates
    const milestoneField: Record<string, string> = {
      Issued: "issued_at",
      Accepted: "accepted_at",
      Shipped: "shipped_at",
      Received: "received_at",
      "Partially Received": "received_at",
    };
    const now = new Date().toISOString();
    const upsertData: Record<string, unknown> = {
      po_id: id,
      status,
      updated_at: now,
      updated_by: "Ryan Belanger",
    };
    // Set the milestone timestamp if this status maps to one
    if (milestoneField[status]) {
      upsertData[milestoneField[status]] = now;
    }

    // Upsert status (row was seeded at PO creation; upsert handles any edge cases)
    const { error: statusError } = await db
      .schema("orchard_calcs")
      .from("po_statuses")
      .upsert(upsertData, { onConflict: "po_id" });

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
