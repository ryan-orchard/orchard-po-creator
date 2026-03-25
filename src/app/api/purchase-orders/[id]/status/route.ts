import { NextRequest, NextResponse } from "next/server";
import { updateRecord, TABLES } from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status, soNumber } = await request.json();

  try {
    const fields: Record<string, unknown> = { Status: status };
    if (soNumber) fields["ANS SO Number"] = soNumber;
    await updateRecord(TABLES.PURCHASE_ORDERS, id, fields);

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
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 }
    );
  }
}
