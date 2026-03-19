import { NextRequest, NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";

/**
 * GET /api/purchase-orders/[id]/activity
 *
 * Returns all activity log entries for a PO, sorted newest first.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const records = await getRecords(TABLES.ACTIVITY_LOG, {
      filterByFormula: `{PO Record ID} = "${id}"`,
    });

    const activities = records
      .map((r) => ({
        id: r.id,
        action: (r.fields["Action"] as string) || "",
        description: (r.fields["Description"] as string) || "",
        actor: (r.fields["Actor"] as string) || "",
        relatedRecordType: (r.fields["Related Record Type"] as string) || null,
        relatedRecordId: (r.fields["Related Record ID"] as string) || null,
        createdTime: r.createdTime || "",
      }))
      .sort((a, b) => new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime());

    return NextResponse.json(activities);
  } catch (error) {
    console.error("Error fetching activity log:", error);
    return NextResponse.json(
      { error: "Failed to fetch activity log" },
      { status: 500 }
    );
  }
}
