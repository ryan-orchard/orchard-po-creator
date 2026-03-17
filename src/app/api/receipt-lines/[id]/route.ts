import { NextRequest, NextResponse } from "next/server";
import { updateRecord, TABLES } from "@/lib/airtable";

/**
 * PATCH /api/receipt-lines/[id]
 *
 * Update a receipt line's SKU link.
 * Body: { skuId: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { skuId } = body as { skuId: string };

    if (!skuId) {
      return NextResponse.json({ error: "skuId is required" }, { status: 400 });
    }

    await updateRecord(TABLES.RECEIPT_LINES, id, {
      SKU: [skuId],
    });

    return NextResponse.json({ success: true, id, skuId });
  } catch (error) {
    console.error("Update receipt line error:", error);
    return NextResponse.json(
      { error: `Failed to update: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
