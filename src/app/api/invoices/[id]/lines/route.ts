import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id: invoiceId } = await params;
  const body = await request.json();
  const lines = body.lines as {
    id: string;
    itemId?: string | null;
    description?: string;
    qty?: number;
    unitPrice?: number;
    total?: number;
  }[];

  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: "No lines provided" }, { status: 400 });
  }

  // Verify the invoice exists
  const { data: invoice } = await db
    .schema("orchard")
    .from("invoices")
    .select("id")
    .eq("id", invoiceId)
    .single();

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Update each line
  const errors: string[] = [];
  for (const line of lines) {
    const updates: Record<string, unknown> = {};
    if ("itemId" in line) updates.item_id = line.itemId || null;
    if ("description" in line) updates.description = line.description;
    if ("qty" in line) updates.qty = line.qty;
    if ("unitPrice" in line) updates.unit_price = line.unitPrice;
    if ("total" in line) updates.total = line.total;

    if (Object.keys(updates).length === 0) continue;

    const { error } = await db
      .schema("orchard")
      .from("invoice_lines")
      .update(updates)
      .eq("id", line.id)
      .eq("invoice_id", invoiceId);

    if (error) errors.push(`Line ${line.id}: ${error.message}`);
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
