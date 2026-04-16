import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { paymentStatus, matchStatus, classification } = body as {
    paymentStatus?: string;
    matchStatus?: string;
    classification?: string;
  };

  if (!paymentStatus && !matchStatus && classification === undefined) {
    return NextResponse.json({ error: "At least one status field is required" }, { status: 400 });
  }

  try {
    // Update denormalized fields on invoices table
    const invoiceUpdates: Record<string, unknown> = {};
    if (matchStatus) invoiceUpdates.match_status = matchStatus;
    if (classification !== undefined) invoiceUpdates.classification = classification;

    if (Object.keys(invoiceUpdates).length > 0) {
      await db.schema("orchard").from("invoices").update(invoiceUpdates).eq("id", id);
    }

    // Upsert into invoice_statuses (authoritative for payment + match status)
    const statusUpsert: Record<string, unknown> = { invoice_id: id, updated_by: "Ryan Belanger" };
    if (paymentStatus) statusUpsert.payment_status = paymentStatus;
    if (matchStatus) statusUpsert.match_status = matchStatus;

    await db
      .schema("orchard_calcs")
      .from("invoice_statuses")
      .upsert(statusUpsert, { onConflict: "invoice_id" });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
