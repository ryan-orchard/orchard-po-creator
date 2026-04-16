import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";

const VALID_STATUSES = ["Draft", "Issued", "In Progress", "Completed", "Cancelled"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status } = await request.json();

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const { data: existing } = await db
      .schema("orchard")
      .from("work_orders")
      .select("wo_number, status, completed_date")
      .eq("id", id)
      .single();

    const oldStatus = existing?.status ?? "";
    const woNumber = existing?.wo_number ?? id;

    const updates: Record<string, unknown> = { status };
    if (status === "Completed" && !existing?.completed_date) {
      updates.completed_date = new Date().toISOString().split("T")[0];
    }

    const { error } = await db.schema("orchard").from("work_orders").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    logActivity({
      woId: id,
      action: "wo_status_changed",
      description: `${woNumber} status: ${oldStatus} → ${status}`,
      actor: "Ryan Belanger",
      relatedRecordType: "work_order",
      relatedRecordId: id,
    });

    return NextResponse.json({ id, status });
  } catch {
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
