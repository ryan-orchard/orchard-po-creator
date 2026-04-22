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
    data.map((item) => ({
      id: item.id,
      standardSku: item.sku,
      name: item.name !== item.sku ? item.name : null,
      category: item.category ?? null,
      uom: item.unit_of_measure,
      count: item.sticks_per_carton,
      description: item.description,
      status: item.is_active ? "Active" : "Inactive",
      supplierItemName: item.supplier_item_name ?? null,
    }))
  );
}

export async function POST(req: Request) {
  const authError = await requireOperator();
  if (authError) return authError;

  const body = await req.json();

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
      category: body.category ?? null,
      supplier_item_name: body.supplierItemName ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    standardSku: data.sku,
    name: data.name !== data.sku ? data.name : null,
    category: data.category ?? null,
    uom: data.unit_of_measure,
    count: data.sticks_per_carton,
    description: data.description,
    status: data.is_active ? "Active" : "Inactive",
  });
}
