import { NextRequest, NextResponse } from "next/server";
import { updateRecord, TABLES } from "@/lib/airtable";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { reviewStatus, paymentStatus } = body as {
      reviewStatus?: string;
      paymentStatus?: string;
    };

    if (!reviewStatus && !paymentStatus) {
      return NextResponse.json(
        { error: "reviewStatus or paymentStatus is required" },
        { status: 400 }
      );
    }

    const fields: Record<string, unknown> = {};
    if (reviewStatus) fields["Review Status"] = reviewStatus;
    if (paymentStatus) fields["Payment Status"] = paymentStatus;

    await updateRecord(TABLES.INVOICES, id, fields);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating invoice status:", error);
    return NextResponse.json(
      { error: "Failed to update status" },
      { status: 500 }
    );
  }
}
