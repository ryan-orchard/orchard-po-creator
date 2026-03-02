import { NextRequest, NextResponse } from "next/server";
import { updateRecord, TABLES } from "@/lib/airtable";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { status } = await request.json();

  try {
    await updateRecord(TABLES.PURCHASE_ORDERS, id, { Status: status });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 }
    );
  }
}
