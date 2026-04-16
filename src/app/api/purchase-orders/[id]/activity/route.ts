import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

/**
 * GET /api/purchase-orders/[id]/activity
 *
 * Returns all events for a PO, sorted newest first.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { data, error } = await db
      .schema("orchard_calcs")
      .from("events")
      .select("id, event_type, payload, created_by, created_at")
      .eq("record_type", "po")
      .eq("record_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type Event = {
      id: string;
      event_type: string;
      payload: Record<string, unknown> | null;
      created_by: string;
      created_at: string;
    };

    const activities = (data as Event[]).map((e) => ({
      id: e.id,
      action: e.event_type,
      description: (e.payload?.description as string) ?? "",
      actor: e.created_by,
      relatedRecordType: (e.payload?.relatedRecordType as string) ?? null,
      relatedRecordId: (e.payload?.relatedRecordId as string) ?? null,
      createdTime: e.created_at,
    }));

    return NextResponse.json(activities);
  } catch (error) {
    console.error("Error fetching activity log:", error);
    return NextResponse.json({ error: "Failed to fetch activity log" }, { status: 500 });
  }
}
