import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await db
    .schema("org_config")
    .from("locations")
    .select("id, name, code, address, city, state, zip")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    data.map((l) => ({
      id: l.id,
      name: l.name,
      code: l.code,
      address: l.address ?? null,
      city: l.city ?? null,
      state: l.state ?? null,
      zip: l.zip ?? null,
      isDefault: false,
    }))
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const { data, error } = await db
    .schema("org_config")
    .from("locations")
    .insert({
      name: body.name,
      code: body.code ?? body.name.toUpperCase().slice(0, 8),
      address: body.address || null,
      city: body.city || null,
      state: body.state || null,
      zip: body.zip || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    code: data.code,
    address: data.address ?? null,
    city: data.city ?? null,
    state: data.state ?? null,
    zip: data.zip ?? null,
    isDefault: false,
  });
}
