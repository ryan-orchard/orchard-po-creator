import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function GET() {
  const { data, error } = await db
    .schema("org_config")
    .from("suppliers")
    .select("*")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    data.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      contactEmail: s.contact_email,
      contactPhone: s.contact_phone,
      // fields not in new schema — preserved as null for API compatibility
      type: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      contactName: null,
      paymentTerms: null,
      shippingTerms: null,
      categories: [],
    }))
  );
}
