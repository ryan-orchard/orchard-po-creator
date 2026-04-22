import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await db
    .schema("org_config")
    .from("items")
    .select("*")
    .order("sku");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    data.map((item) => {
      const meta = item.metadata as Record<string, unknown> | null;
      return {
        id: item.id,
        standardSku: item.sku,
        name: (meta?.flavor as string) || (item.name !== item.sku ? item.name : null) || null,
        category: (meta?.category as string) ?? null,
        flavor: (meta?.flavor as string) ?? null,
        uom: item.unit_of_measure,
        count: item.sticks_per_carton,
        description: item.description,
        status: item.is_active ? "Active" : "Inactive",
        supplierItemName: (meta?.supplierItemName as string) ?? null,
        unitCost: (meta?.unitCost as number) ?? null,
      };
    })
  );
}

export async function POST(req: Request) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await req.json();

  const metadata: Record<string, unknown> = {
    category: body.category ?? null,
    flavor: body.name ?? body.flavor ?? null,
  };
  if (body.unitCost != null) metadata.unitCost = body.unitCost;

  const { data, error } = await db
    .schema("org_config")
    .from("items")
    .insert({
      sku: body.standardSku,
      name: body.name || body.standardSku,
      unit_of_measure: body.uom ?? null,
      sticks_per_carton: body.uom === "Carton" && body.count != null ? Number(body.count) : null,
      description: body.description ?? null,
      is_active: body.status !== "Inactive",
      metadata,
    })
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
