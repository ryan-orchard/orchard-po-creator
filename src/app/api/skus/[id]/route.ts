import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const { data, error } = await db
    .schema("org_config")
    .from("items")
    .update({
      sku: body.standardSku,
      name: body.standardSku,
      unit_of_measure: body.uom ?? null,
      sticks_per_carton: body.uom === "Carton" && body.count != null ? Number(body.count) : null,
      description: body.description ?? null,
      is_active: body.status !== "Inactive",
      metadata: { category: body.category ?? null, flavor: body.flavor ?? null },
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    standardSku: data.sku,
    category: (data.metadata as Record<string, unknown>)?.category ?? null,
    flavor: (data.metadata as Record<string, unknown>)?.flavor ?? null,
    uom: data.unit_of_measure,
    count: data.sticks_per_carton,
    description: data.description,
    status: data.is_active ? "Active" : "Inactive",
  });
}
