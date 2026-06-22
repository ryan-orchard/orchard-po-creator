import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";

// PATCH /api/po-lines/[id]/status
// Sets the status of a SINGLE PO line to 'draft', 'ordered', or 'confirmed'.
// 'complete' is not handled here — it goes through POST /api/po-lines/[id]/complete,
// which also posts the Acquisition movement.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;
  const { status } = await request.json();

  if (status !== "draft" && status !== "ordered" && status !== "confirmed") {
    return NextResponse.json(
      { error: "status must be 'draft', 'ordered', or 'confirmed' (use /complete for complete)" },
      { status: 400 }
    );
  }

  // Resolve the line's PO for the activity log + existence check.
  const { data: line, error: lineErr } = await db
    .schema("orchard")
    .from("po_lines")
    .select("id, po_id")
    .eq("id", id)
    .maybeSingle();
  if (lineErr) return NextResponse.json({ error: lineErr.message }, { status: 500 });
  if (!line) return NextResponse.json({ error: "PO line not found" }, { status: 404 });

  const { error } = await db
    .schema("orchard_calcs")
    .from("po_line_statuses")
    .upsert(
      {
        po_line_id: id,
        status,
        updated_at: new Date().toISOString(),
        updated_by: "Ryan Belanger",
      },
      { onConflict: "po_line_id" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logActivity({
    poId: line.po_id as string,
    action: "line_status_changed",
    description: `Line status set to ${status}`,
    actor: "Ryan Belanger",
  });

  return NextResponse.json({ success: true });
}
