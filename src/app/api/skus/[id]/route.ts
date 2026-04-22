import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  // Fetch existing metadata to preserve fields we're not editing
  const { data: existing } = await db
    .schema("org_config")
    .from("items")
    .select("metadata")
    .eq("id", id)
    .single();

  const existingMeta = (existing?.metadata as Record<string, unknown>) ?? {};

  const metadata: Record<string, unknown> = {
    ...existingMeta,
    category: body.category ?? null,
    flavor: body.name ?? body.flavor ?? null,
  };
  if (body.unitCost != null) {
    metadata.unitCost = body.unitCost;
  } else if ("unitCost" in body) {
    metadata.unitCost = null;
  }

  const { data, error } = await db
    .schema("org_config")
    .from("items")
    .update({
      sku: body.standardSku,
      name: body.name || body.standardSku,
      unit_of_measure: body.uom ?? null,
      sticks_per_carton: body.uom === "Carton" && body.count != null ? Number(body.count) : null,
      description: body.description ?? null,
      is_active: body.status !== "Inactive",
      metadata,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const meta = data.metadata as Record<string, unknown> | null;
  return NextResponse.json({
    id: data.id,
    standardSku: data.sku,
    name: (meta?.flavor as string) || (data.name !== data.sku ? data.name : null) || null,
    category: (meta?.category as string) ?? null,
    uom: data.unit_of_measure,
    count: data.sticks_per_carton,
    description: data.description,
    status: data.is_active ? "Active" : "Inactive",
    unitCost: (meta?.unitCost as number) ?? null,
  });
}
