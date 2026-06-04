import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

// GET /api/boms — list all BOMs grouped by finished good
// Each BOM = { finishedGoodId, finishedGoodSku, finishedGoodName, uom, isActive, components[] }
export async function GET() {
  const [bomsResult, itemsResult] = await Promise.all([
    db.schema("org_config").from("bill_of_materials").select("*"),
    db.schema("org_config").from("items")
      .select("id, sku, name, unit_of_measure, accounting_category")
      .eq("accounting_category", "FG")
      .eq("is_active", true),
  ]);

  if (bomsResult.error) return NextResponse.json({ error: bomsResult.error.message }, { status: 500 });

  const fgItemMap = new Map((itemsResult.data ?? []).map((i) => [i.id, i]));

  // Group BOM rows by finished_good_id
  type BomRow = {
    finished_good_id: string;
    component_id: string;
    qty: number;
    is_active: boolean;
    finished_good_sku: string;
    finished_good_name: string;
    component_sku: string;
    component_name: string;
  };

  const grouped = new Map<string, { fgId: string; rows: BomRow[] }>();
  for (const row of (bomsResult.data ?? []) as BomRow[]) {
    if (!grouped.has(row.finished_good_id)) {
      grouped.set(row.finished_good_id, { fgId: row.finished_good_id, rows: [] });
    }
    grouped.get(row.finished_good_id)!.rows.push(row);
  }

  // Fetch component item details
  const allComponentIds = [...new Set((bomsResult.data ?? []).map((r: BomRow) => r.component_id))];
  const { data: componentItems } = allComponentIds.length
    ? await db.schema("org_config").from("items")
        .select("id, sku, name, unit_of_measure")
        .in("id", allComponentIds)
    : { data: [] };
  const compMap = new Map((componentItems ?? []).map((i) => [i.id, i]));

  const boms = [...grouped.values()].map(({ fgId, rows }) => {
    const fgItem = fgItemMap.get(fgId);
    const isActive = rows.some((r) => r.is_active);
    return {
      finishedGoodId: fgId,
      finishedGoodSku: fgItem?.sku ?? rows[0]?.finished_good_sku ?? "",
      finishedGoodName: fgItem?.name ?? rows[0]?.finished_good_name ?? "",
      uom: fgItem?.unit_of_measure ?? "",
      isActive,
      componentCount: rows.length,
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
    };
  });

  // Sort: active first, then by finished good SKU
  boms.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.finishedGoodSku.localeCompare(b.finishedGoodSku);
  });

  return NextResponse.json(boms);
}

// POST /api/boms — create or replace a BOM for a finished good
// Body: { finishedGoodId: string, components: [{ componentId, qtyPerOutput }] }
export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await request.json();
  const { finishedGoodId, components } = body as {
    finishedGoodId: string;
    components: { componentId: string; qtyPerOutput: number }[];
  };

  if (!finishedGoodId || !components?.length) {
    return NextResponse.json({ error: "finishedGoodId and components are required" }, { status: 400 });
  }

  // Fetch FG + component item details for denormalized columns
  const allItemIds = [finishedGoodId, ...components.map((c) => c.componentId)];
  const { data: items } = await db.schema("org_config").from("items")
    .select("id, sku, name, unit_of_measure")
    .in("id", allItemIds);

  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));
  const fgItem = itemMap.get(finishedGoodId);
  if (!fgItem) return NextResponse.json({ error: "Finished good not found" }, { status: 404 });

  // Delete existing rows for this FG, then insert fresh
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
