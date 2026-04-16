import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await db
    .schema("org_config")
    .from("locations")
    .select("*")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    data.map((l) => ({
      id: l.id,
      name: l.name,
      code: l.code,
      // fields not in new schema — preserved as null for API compatibility
      address: null,
      city: null,
      state: null,
      zip: null,
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
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    name: data.name,
    code: data.code,
    address: null,
    city: null,
    state: null,
    zip: null,
    isDefault: false,
  });
}
