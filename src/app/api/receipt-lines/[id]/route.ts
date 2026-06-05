import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import {
  setReceiptLineTransferStatus,
  setReceiptLineInvoiceStatus,
  setReceiptLineFlag,
  type ReceiptLineTransferStatus,
  type ReceiptLineInvoiceStatus,
  type ReceiptLineFlag,
} from "@/lib/receipt-status";

/**
 * PATCH /api/receipt-lines/[id]
 *
 * Supports:
 * - { skuId: string } — update item link
 * - { transferStatus: "unmatched" | "partial" | "matched" } — update transfer match state
 * - { invoiceStatus: "unmatched" | "matched" } — update invoice match state
 * - { flag: "excluded" | "review" | null } — set or clear operational flag
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireOperator();
  if (authError) return authError;
  try {
    const { id } = await params;
    const body = await request.json();
    let didSomething = false;

    if (body.skuId !== undefined) {
      if (!body.skuId) return NextResponse.json({ error: "skuId cannot be empty" }, { status: 400 });
      const { error } = await db
        .schema("orchard_calcs")
        .from("receipt_lines")
        .update({ item_id: body.skuId })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      didSomething = true;
    }

    if (body.transferStatus !== undefined) {
      const valid: ReceiptLineTransferStatus[] = ["unmatched", "partial", "matched"];
      if (!valid.includes(body.transferStatus)) {
        return NextResponse.json({ error: `transferStatus must be one of: ${valid.join(", ")}` }, { status: 400 });
      }
      const { error } = await setReceiptLineTransferStatus(id, body.transferStatus, "Ryan Belanger");
      if (error) return NextResponse.json({ error: (error as { message?: string }).message ?? "status update failed" }, { status: 500 });
      didSomething = true;
    }

    if (body.invoiceStatus !== undefined) {
      const valid: ReceiptLineInvoiceStatus[] = ["unmatched", "matched"];
      if (!valid.includes(body.invoiceStatus)) {
        return NextResponse.json({ error: `invoiceStatus must be one of: ${valid.join(", ")}` }, { status: 400 });
      }
      const { error } = await setReceiptLineInvoiceStatus(id, body.invoiceStatus, "Ryan Belanger");
      if (error) return NextResponse.json({ error: (error as { message?: string }).message ?? "status update failed" }, { status: 500 });
      didSomething = true;
    }

    if (body.flag !== undefined) {
      const valid: (ReceiptLineFlag)[] = ["excluded", "review", null];
      if (!valid.includes(body.flag)) {
        return NextResponse.json({ error: `flag must be one of: excluded, review, null` }, { status: 400 });
      }
      const { error } = await setReceiptLineFlag(id, body.flag as ReceiptLineFlag, "Ryan Belanger");
      if (error) return NextResponse.json({ error: (error as { message?: string }).message ?? "flag update failed" }, { status: 500 });
      didSomething = true;
    }

    if (!didSomething) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    return NextResponse.json({ success: true, id });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to update: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
