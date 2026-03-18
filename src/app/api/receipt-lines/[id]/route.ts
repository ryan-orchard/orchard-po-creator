import { NextRequest, NextResponse } from "next/server";
import { updateRecord, TABLES } from "@/lib/airtable";

/**
 * PATCH /api/receipt-lines/[id]
 *
 * Update a receipt line. Supports:
 * - { skuId: string } — Update SKU link
 * - { matchStatus: "Open" | "Matched" | "Excluded" | "Review" } — Update match status
 * - { reviewNote: string } — Set review note (for client review items)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const fields: Record<string, unknown> = {};

    if (body.skuId !== undefined) {
      if (!body.skuId) {
        return NextResponse.json(
          { error: "skuId cannot be empty" },
          { status: 400 }
        );
      }
      fields["SKU"] = [body.skuId];
    }

    if (body.matchStatus !== undefined) {
      const valid = ["Open", "Matched", "Excluded", "Review"];
      if (!valid.includes(body.matchStatus)) {
        return NextResponse.json(
          { error: `matchStatus must be one of: ${valid.join(", ")}` },
          { status: 400 }
        );
      }
      fields["Match Status"] = body.matchStatus;
    }

    if (body.reviewNote !== undefined) {
      fields["Review Notes"] = body.reviewNote;
    }

    if (Object.keys(fields).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    await updateRecord(TABLES.RECEIPT_LINES, id, fields);

    return NextResponse.json({ success: true, id });
  } catch (error) {
    console.error("Update receipt line error:", error);
    return NextResponse.json(
      {
        error: `Failed to update: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
