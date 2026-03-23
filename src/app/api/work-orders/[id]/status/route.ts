import { NextRequest, NextResponse } from "next/server";
import { getRecord, updateRecord, TABLES } from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

const VALID_STATUSES = ["Draft", "Issued", "In Progress", "Completed", "Cancelled"];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const { status } = body;

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const existing = await getRecord(TABLES.WORK_ORDERS, id);
    const woNumber = existing.fields["WO Number"] as string;
    const oldStatus = existing.fields["Status"] as string;

    const fields: Record<string, unknown> = { Status: status };

    // Auto-set Completed Date when marking complete
    if (status === "Completed" && !existing.fields["Completion Date"]) {
      fields["Completion Date"] = new Date().toISOString().split("T")[0];
    }

    await updateRecord(TABLES.WORK_ORDERS, id, fields);

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
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 }
    );
  }
}
