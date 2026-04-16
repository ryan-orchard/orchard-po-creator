import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status } = await request.json();

  try {
    const { error } = await db
      .schema("orchard")
      .from("shipments")
      .update({ status })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
