import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { generateNextNumber } from "@/lib/sequence";
import { logActivity } from "@/lib/activity-log";

export async function GET() {
  const [wosResult, linesResult, itemsResult] = await Promise.all([
    db.schema("orchard").from("work_orders").select("*").order("issued_date", { ascending: false }),
    db.schema("orchard").from("work_order_lines").select("wo_id, item_id, line_type"),
    db.schema("org_config").from("items").select("id, sku"),
  ]);

  if (wosResult.error) return NextResponse.json({ error: wosResult.error.message }, { status: 500 });

  const itemMap = new Map((itemsResult.data ?? []).map((i) => [i.id, i.sku]));

  // Group output SKU names + line counts by WO
  const lineIdsByWO: Record<string, number> = {};
  const outputSkusByWO: Record<string, string[]> = {};
  for (const l of linesResult.data ?? []) {
    lineIdsByWO[l.wo_id] = (lineIdsByWO[l.wo_id] ?? 0) + 1;
    if (l.line_type === "Output") {
      const sku = itemMap.get(l.item_id);
      if (sku) {
        if (!outputSkusByWO[l.wo_id]) outputSkusByWO[l.wo_id] = [];
        if (!outputSkusByWO[l.wo_id].includes(sku)) outputSkusByWO[l.wo_id].push(sku);
      }
    }
  }

  type WO = {
    id: string; wo_number: string; notes: string | null; location_id: string;
    status: string; issued_date: string | null; completed_date: string | null;
  };

  const wos = (wosResult.data as WO[]).map((w) => ({
    id: w.id,
    woNumber: w.wo_number,
    description: w.notes,
    warehouse: [w.location_id],
    status: w.status,
    issuedDate: w.issued_date,
    completedDate: w.completed_date,
    lineItems: Array(lineIdsByWO[w.id] ?? 0).fill(null), // frontend uses .length
    outputSkus: outputSkusByWO[w.id] ?? [],
  }));

  return NextResponse.json(wos);
}

export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await request.json();
  const woNumber = await generateNextNumber("WO");

  const { data: wo, error: woError } = await db
    .schema("orchard")
    .from("work_orders")
    .insert({
      wo_number: woNumber,
      notes: body.description || null,
      location_id: body.warehouseId,
      status: "Draft",
      issued_date: body.issuedDate || null,
    })
    .select("id")
    .single();

  if (woError || !wo) {
    return NextResponse.json({ error: woError?.message ?? "Failed to create WO" }, { status: 500 });
  }

  if (body.lineItems && body.lineItems.length > 0) {
    const lineRows = (body.lineItems as { skuId: string; lineType: "Input" | "Output"; qty: number }[]).map((item) => ({
      wo_id: wo.id,
      item_id: item.skuId,
      line_type: item.lineType,
      qty: item.qty,
    }));
    const { error: lineError } = await db.schema("orchard").from("work_order_lines").insert(lineRows);
    if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });
  }

  logActivity({
    woId: wo.id,
    action: "wo_created",
    description: `Created ${woNumber}: ${body.description || ""}`.trim(),
    actor: "Ryan Belanger",
    relatedRecordType: "work_order",
    relatedRecordId: wo.id,
  });

  return NextResponse.json({ id: wo.id, woNumber });
}
