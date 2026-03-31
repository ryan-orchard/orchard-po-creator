import { NextRequest, NextResponse } from "next/server";
import { updateRecord, TABLES } from "@/lib/airtable";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { paymentStatus, matchStatus, reviewNotes, classification } = body as {
      paymentStatus?: string;
      matchStatus?: string;
      reviewNotes?: string;
      classification?: string;
    };

    if (!paymentStatus && !matchStatus && reviewNotes === undefined && classification === undefined) {
      return NextResponse.json(
        { error: "At least one status field is required" },
        { status: 400 }
      );
    }

    const fields: Record<string, unknown> = {};
    if (paymentStatus) fields["Payment Status"] = paymentStatus;
    if (matchStatus) fields["Status"] = matchStatus;
    if (reviewNotes !== undefined) fields["Review Notes"] = reviewNotes;
    if (classification !== undefined) fields["Classification"] = classification;

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
