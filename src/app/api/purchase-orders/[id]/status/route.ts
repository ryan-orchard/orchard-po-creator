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
    // Write status first — always succeeds independently of SO number
    await updateRecord(TABLES.PURCHASE_ORDERS, id, { Status: status });

    // Write SO number separately so a field issue doesn't block the status save
    if (soNumber) {
      try {
        await updateRecord(TABLES.PURCHASE_ORDERS, id, { "ANS SO Number": soNumber });
      } catch (soErr) {
        console.error("Failed to save ANS SO Number:", soErr);
        // Still return success — status was saved; SO number can be entered manually
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
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 }
    );
  }
}
