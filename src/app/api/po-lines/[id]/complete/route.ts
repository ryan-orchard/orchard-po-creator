import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

// POST /api/po-lines/[id]/complete
// Marks a PO line 'complete' (produced) and posts the Acquisition movement —
// goods received into the supplier's own warehouse (bill-and-hold shape).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const completedDate: string = body.completedDate || new Date().toISOString().slice(0, 10);

  const { data: poLine, error: plError } = await db
    .schema("orchard")
    .from("po_lines")
    .select("id, po_id, item_id, qty")
    .eq("id", id)
    .single();
  if (plError || !poLine) {
    return NextResponse.json({ error: "PO line not found" }, { status: 404 });
  }

  const { data: po } = await db
    .schema("orchard")
    .from("purchase_orders")
    .select("id, supplier_id")
    .eq("id", poLine.po_id)
    .maybeSingle();

  // Mark the line complete.
  const { error: stError } = await db
    .schema("orchard_calcs")
    .from("po_line_statuses")
    .upsert(
      {
        po_line_id: id,
        status: "complete",
        updated_at: new Date().toISOString(),
        updated_by: "Ryan Belanger",
      },
      { onConflict: "po_line_id" }
    );
  if (stError) return NextResponse.json({ error: stError.message }, { status: 500 });

  // Resolve the supplier's location (supplier.code matches location.code).
  let supplierLocationId: string | null = null;
  if (po?.supplier_id) {
    const { data: supplier } = await db
      .schema("org_config")
      .from("suppliers")
      .select("code")
      .eq("id", po.supplier_id)
      .maybeSingle();
    if (supplier?.code) {
      const { data: loc } = await db
        .schema("org_config")
        .from("locations")
        .select("id")
        .eq("code", supplier.code)
        .maybeSingle();
      supplierLocationId = (loc?.id as string | null) ?? null;
    }
  }

  if (!supplierLocationId) {
    return NextResponse.json({
      success: true,
      id,
      acquisitionPosted: false,
      warning:
        "Line marked complete, but no location matches the supplier — Acquisition movement not posted.",
    });
  }

  // One Acquisition per PO line — don't double-post on re-run.
  const { data: existing } = await db
    .schema("orchard_calcs")
    .from("movements")
    .select("id")
    .eq("source_doc_type", "po_line")
    .eq("source_doc_id", id)
    .maybeSingle();

  if (!existing) {
    // Path auto-match: exactly one active Acquisition path supplier -> supplier.
    const { data: item } = await db
      .schema("org_config")
      .from("items")
      .select("accounting_category")
      .eq("id", poLine.item_id)
      .maybeSingle();
    const { data: paths } = await db
      .schema("org_config")
      .from("paths")
      .select("id, item_category")
      .eq("type", "Acquisition")
      .eq("is_active", true)
      .eq("from_location_id", supplierLocationId)
      .eq("to_location_id", supplierLocationId);
    const matching = (paths ?? []).filter(
      (p) => p.item_category == null || p.item_category === item?.accounting_category
    );
    const pathId = matching.length === 1 ? (matching[0].id as string) : null;

    const { error: movError } = await db
      .schema("orchard_calcs")
      .from("movements")
      .insert({
        type: "Acquisition",
        from_location_id: supplierLocationId,
        to_location_id: supplierLocationId,
        item_id: poLine.item_id,
        qty: poLine.qty,
        occurred_at: new Date(completedDate).toISOString(),
        path_id: pathId,
        source_doc_type: "po_line",
        source_doc_id: id,
        status: "confirmed",
      });
    if (movError) return NextResponse.json({ error: movError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id, acquisitionPosted: true });
}
