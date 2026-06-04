import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

// GET /api/boms/[id] — single BOM by finished_good_id
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: finishedGoodId } = await params;

  const [bomsResult, fgResult] = await Promise.all([
    db.schema("org_config").from("bill_of_materials").select("*").eq("finished_good_id", finishedGoodId),
    db.schema("org_config").from("items")
      .select("id, sku, name, unit_of_measure, accounting_category")
      .eq("id", finishedGoodId)
      .single(),
  ]);

  if (bomsResult.error) return NextResponse.json({ error: bomsResult.error.message }, { status: 500 });
  if (!fgResult.data) return NextResponse.json({ error: "BOM not found" }, { status: 404 });

  const rows = bomsResult.data as {
    finished_good_id: string;
    component_id: string;
    qty: number;
    is_active: boolean;
    component_sku: string;
    component_name: string;
  }[];

  const componentIds = rows.map((r) => r.component_id);
  const { data: compItems } = componentIds.length
    ? await db.schema("org_config").from("items")
        .select("id, sku, name, unit_of_measure")
        .in("id", componentIds)
    : { data: [] };
  const compMap = new Map((compItems ?? []).map((i) => [i.id, i]));

  const fg = fgResult.data;
  return NextResponse.json({
    finishedGoodId: fg.id,
    finishedGoodSku: fg.sku,
    finishedGoodName: fg.name,
    uom: fg.unit_of_measure,
    components: rows.map((r) => {
      const comp = compMap.get(r.component_id);
      return {
        componentId: r.component_id,
        componentSku: comp?.sku ?? r.component_sku,
        componentName: comp?.name ?? r.component_name,
        uom: comp?.unit_of_measure ?? "",
        qtyPerOutput: r.qty,
        isActive: r.is_active,
      };
    }),
  });
}

// PUT /api/boms/[id] — replace all components for a BOM
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id: finishedGoodId } = await params;
  const body = await request.json();
  const { components } = body as {
    components: { componentId: string; qtyPerOutput: number }[];
  };

  if (!components?.length) {
    return NextResponse.json({ error: "At least one component is required" }, { status: 400 });
  }

  const allItemIds = [finishedGoodId, ...components.map((c) => c.componentId)];
  const { data: items } = await db.schema("org_config").from("items")
    .select("id, sku, name, unit_of_measure")
    .in("id", allItemIds);

  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));
  const fgItem = itemMap.get(finishedGoodId);
  if (!fgItem) return NextResponse.json({ error: "Finished good not found" }, { status: 404 });

  const { error: deleteError } = await db.schema("org_config")
    .from("bill_of_materials")
    .delete()
    .eq("finished_good_id", finishedGoodId);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  const rows = components.map((c) => {
    const comp = itemMap.get(c.componentId);
    return {
      finished_good_id: finishedGoodId,
      component_id: c.componentId,
      qty: c.qtyPerOutput,
      is_active: true,
      finished_good_sku: fgItem.sku,
      finished_good_name: fgItem.name,
      component_sku: comp?.sku ?? "",
      component_name: comp?.name ?? "",
    };
  });

  const { error: insertError } = await db.schema("org_config").from("bill_of_materials").insert(rows);
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ finishedGoodId });
}

// DELETE /api/boms/[id] — remove all BOM rows for a finished good
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id: finishedGoodId } = await params;
  const { error } = await db.schema("org_config")
    .from("bill_of_materials")
    .delete()
    .eq("finished_good_id", finishedGoodId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
