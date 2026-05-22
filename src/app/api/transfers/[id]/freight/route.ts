import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

// POST /api/transfers/[id]/freight
// Sets the freight cost for a transfer. Replaces any prior freight and
// allocates the amount pro-rata by qty across the transfer's movements
// as movement_costs rows (cost_type 'freight').
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const amount = Math.max(0, Number(body.amount) || 0);

  const { data: lines } = await db
    .schema("orchard")
    .from("transfer_lines")
    .select("id")
    .eq("transfer_id", id);
  const lineIds = (lines ?? []).map((l) => l.id as string);
  if (lineIds.length === 0) {
    return NextResponse.json({ error: "Transfer has no lines" }, { status: 400 });
  }

  const { data: movements } = await db
    .schema("orchard_calcs")
    .from("movements")
    .select("id, qty")
    .eq("source_doc_type", "transfer_line")
    .in("source_doc_id", lineIds);
  const movs = movements ?? [];
  if (movs.length === 0) {
    return NextResponse.json({ error: "Transfer has no movements yet" }, { status: 400 });
  }
  const movIds = movs.map((m) => m.id as string);

  // Replace any existing freight allocation for this transfer.
  await db
    .schema("orchard_calcs")
    .from("movement_costs")
    .delete()
    .eq("cost_type", "freight")
    .in("movement_id", movIds);

  if (amount > 0) {
    const totalQty = movs.reduce((s, m) => s + (Number(m.qty) || 0), 0);
    const now = new Date().toISOString();
    let allocated = 0;
    const rows = movs.map((m, idx) => {
      const isLast = idx === movs.length - 1;
      let alloc: number;
      if (isLast) {
        // Last line absorbs the rounding remainder so the total is exact.
        alloc = Math.round((amount - allocated) * 100) / 100;
      } else {
        const share = totalQty > 0 ? (Number(m.qty) || 0) / totalQty : 1 / movs.length;
        alloc = Math.round(amount * share * 100) / 100;
        allocated += alloc;
      }
      return {
        movement_id: m.id,
        cost_type: "freight",
        amount: alloc,
        allocation_method: "pro_rata_qty",
        allocated_at: now,
        notes: "Transfer freight",
      };
    });
    const { error } = await db.schema("orchard_calcs").from("movement_costs").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, freightTotal: amount });
}
