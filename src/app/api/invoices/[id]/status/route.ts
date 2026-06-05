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
    // classification lives on the invoices base table; match/payment status live in invoice_statuses.
    if (classification !== undefined) {
      await db.schema("orchard").from("invoices").update({ classification }).eq("id", id);
    }

    const statusUpsert: Record<string, unknown> = { invoice_id: id, updated_by: "Ryan Belanger" };
    if (paymentStatus) statusUpsert.payment_status = paymentStatus;
    if (matchStatus) statusUpsert.match_status = matchStatus;

    if (paymentStatus || matchStatus) {
      await db
        .schema("orchard_calcs")
        .from("invoice_statuses")
        .upsert(statusUpsert, { onConflict: "invoice_id" });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}
