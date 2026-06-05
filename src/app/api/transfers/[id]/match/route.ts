import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";

function rollUpTransferStatus(statuses: string[]): string {
  if (statuses.length === 0) return "in_transit";
  const active = statuses.filter((s) => s !== "cancelled");
  if (active.length === 0) return "cancelled";
  if (active.every((s) => s === "received")) return "received";
  if (active.some((s) => s === "received" || s === "partial")) return "partial";
  return "in_transit";
}

// POST /api/transfers/[id]/match
// Confirm transfer-line <-> receipt-line matches. Recomputes received qty,
// writes transfer_line_statuses, flips movements, and rolls transfer status
// up from line statuses.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();

  type MatchInput = { transferLineId: string; receiptLineId: string; matchedQty: number };
  const matches: MatchInput[] = body.matches ?? [];
  if (matches.length === 0) {
    return NextResponse.json({ error: "No matches provided" }, { status: 400 });
  }

  const now = new Date().toISOString();

  const linkRows = matches.map((m) => ({
    transfer_line_id: m.transferLineId,
    receipt_line_id: m.receiptLineId,
    matched_qty: m.matchedQty,
    match_method: "manual",
    confirmed: true,
    confirmed_by: "Ryan Belanger",
    confirmed_at: now,
    created_by: "Ryan Belanger",
  }));

  const { error: linkError } = await db
    .schema("orchard_calcs")
    .from("transfer_line_receipt_line_links")
    .upsert(linkRows, { onConflict: "transfer_line_id,receipt_line_id" });
  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });

  // Recompute received qty for every line on this transfer.
  const { data: linesData } = await db
    .schema("orchard")
    .from("transfer_lines")
    .select("id, shipped_qty")
    .eq("transfer_id", id);
  const lines = linesData ?? [];
  const lineIds = lines.map((l) => l.id as string);

  const receivedByLine = new Map<string, number>();
  if (lineIds.length > 0) {
    const { data: links } = await db
      .schema("orchard_calcs")
      .from("transfer_line_receipt_line_links")
      .select("transfer_line_id, matched_qty, confirmed")
      .in("transfer_line_id", lineIds);
    for (const l of links ?? []) {
      if (!l.confirmed) continue;
      const k = l.transfer_line_id as string;
      receivedByLine.set(k, (receivedByLine.get(k) ?? 0) + (Number(l.matched_qty) || 0));
    }
  }

  // Update each line's movement and status.
  const lineStatusRows: { transfer_line_id: string; status: string; updated_at: string; updated_by: string }[] = [];
  for (const line of lines) {
    const shipped = Number(line.shipped_qty) || 0;
    const received = receivedByLine.get(line.id as string) ?? 0;
    const movementStatus = shipped > 0 && received === shipped ? "confirmed" : "pending";
    await db
      .schema("orchard_calcs")
      .from("movements")
      .update({ status: movementStatus, updated_at: now })
      .eq("source_doc_type", "transfer_line")
      .eq("source_doc_id", line.id);
    const lineStatus =
      received === 0 ? "in_transit" : received < shipped ? "partial" : "received";
    lineStatusRows.push({ transfer_line_id: line.id as string, status: lineStatus, updated_at: now, updated_by: "Ryan Belanger" });
  }

  if (lineStatusRows.length > 0) {
    await db
      .schema("orchard_calcs")
      .from("transfer_line_statuses")
      .upsert(lineStatusRows, { onConflict: "transfer_line_id" });
  }

  // Roll up to transfer header.
  const lineStatuses = lineStatusRows.map((r) => r.status);
  const newStatus = rollUpTransferStatus(lineStatuses);
  await db
    .schema("orchard")
    .from("transfers")
    .update({ status: newStatus, updated_at: now })
    .eq("id", id);

  return NextResponse.json({
    success: true,
    status: newStatus,
    lines: lines.map((l) => ({
      transferLineId: l.id as string,
      shippedQty: Number(l.shipped_qty) || 0,
      receivedQty: receivedByLine.get(l.id as string) ?? 0,
    })),
  });
}
