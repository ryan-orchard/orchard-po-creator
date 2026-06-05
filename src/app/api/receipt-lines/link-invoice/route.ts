import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { logActivity } from "@/lib/activity-log";
import { setReceiptLineInvoiceStatuses } from "@/lib/receipt-status";

// Supabase PostgrestError isn't an Error instance — pull the useful fields out.
function formatError(err: unknown): string {
  if (!err) return "Unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint, e.code]
      .filter((v) => typeof v === "string" && v.length > 0)
      .map((v) => v as string);
    if (parts.length > 0) return parts.join(" — ");
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * POST /api/receipt-lines/link-invoice
 *
 * Body: { receiptLineIds: string[], invoiceLineIds: string[] }
 *
 * For each receipt line, links it to every selected invoice line that shares
 * its item_id. Receipt lines whose item doesn't match any selected invoice
 * line are returned as `skipped` (no link created).
 *
 * Marks linked receipt lines as Matched. Logs an event on the parent PO
 * (when known) so the activity timeline reflects the link.
 */
export async function POST(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const body = await request.json();
    const receiptLineIds: string[] = Array.isArray(body.receiptLineIds)
      ? body.receiptLineIds
      : [];
    const invoiceLineIds: string[] = Array.isArray(body.invoiceLineIds)
      ? body.invoiceLineIds
      : [];

    if (receiptLineIds.length === 0) {
      return NextResponse.json(
        { error: "receiptLineIds required" },
        { status: 400 }
      );
    }
    if (invoiceLineIds.length === 0) {
      return NextResponse.json(
        { error: "invoiceLineIds required" },
        { status: 400 }
      );
    }

    // Load selected receipt lines from Silver (unified across Stord + BMC)
    const { data: receiptLines, error: rlErr } = await db
      .schema("orchard_calcs")
      .from("receipt_lines")
      .select("id, item_id")
      .in("id", receiptLineIds);
    if (rlErr) throw rlErr;
    if (!receiptLines || receiptLines.length === 0) {
      return NextResponse.json(
        { error: "No receipt lines found" },
        { status: 404 }
      );
    }

    // Load selected invoice lines (and capture invoice_ids for status/event)
    const { data: invoiceLines, error: ilErr } = await db
      .schema("orchard")
      .from("invoice_lines")
      .select("id, invoice_id, item_id")
      .in("id", invoiceLineIds);
    if (ilErr) throw ilErr;
    if (!invoiceLines || invoiceLines.length === 0) {
      return NextResponse.json(
        { error: "No invoice lines found" },
        { status: 404 }
      );
    }

    // itemId → invoiceLineIds (only over the selected invoice lines)
    const invoiceLinesByItem = new Map<string, string[]>();
    for (const il of invoiceLines) {
      const itemId = il.item_id as string | null;
      if (!itemId) continue;
      if (!invoiceLinesByItem.has(itemId))
        invoiceLinesByItem.set(itemId, []);
      invoiceLinesByItem.get(itemId)!.push(il.id as string);
    }

    const linkRows: { receipt_line_id: string; invoice_line_id: string }[] =
      [];
    const linkedReceiptLineIds: string[] = [];
    const skippedReceiptLineIds: string[] = [];

    for (const rl of receiptLines) {
      const itemId = rl.item_id as string | null;
      const matches = itemId ? invoiceLinesByItem.get(itemId) : undefined;
      if (!matches || matches.length === 0) {
        skippedReceiptLineIds.push(rl.id as string);
        continue;
      }
      for (const invoiceLineId of matches) {
        linkRows.push({
          receipt_line_id: rl.id as string,
          invoice_line_id: invoiceLineId,
        });
      }
      linkedReceiptLineIds.push(rl.id as string);
    }

    if (linkRows.length === 0) {
      return NextResponse.json(
        {
          error:
            "No SKU overlap between selected receipt lines and selected invoice lines.",
          linksCreated: 0,
          skipped: skippedReceiptLineIds,
        },
        { status: 400 }
      );
    }

    // Dedupe in code (avoids depending on a specific unique-constraint name).
    const { data: existingLinks, error: existingErr } = await db
      .schema("orchard_calcs")
      .from("receipt_line_invoice_line_links")
      .select("receipt_line_id, invoice_line_id")
      .in(
        "receipt_line_id",
        linkRows.map((r) => r.receipt_line_id)
      )
      .in(
        "invoice_line_id",
        linkRows.map((r) => r.invoice_line_id)
      );
    if (existingErr) throw existingErr;

    const existingSet = new Set(
      (existingLinks ?? []).map(
        (l) => `${l.receipt_line_id}::${l.invoice_line_id}`
      )
    );
    const newLinks = linkRows.filter(
      (l) => !existingSet.has(`${l.receipt_line_id}::${l.invoice_line_id}`)
    );

    if (newLinks.length > 0) {
      const { error: linkErr } = await db
        .schema("orchard_calcs")
        .from("receipt_line_invoice_line_links")
        .insert(
          newLinks.map((l) => ({ ...l, linked_by: "Ryan Belanger" }))
        );
      if (linkErr) throw linkErr;
    }

    // Mark linked receipt lines as Matched (Silver)
    if (linkedReceiptLineIds.length > 0) {
      const { error: statusErr } = await setReceiptLineInvoiceStatuses(linkedReceiptLineIds, "matched", "Ryan Belanger");
      if (statusErr) throw statusErr;
    }

    // Pull invoice info for the response and event logging
    const invoiceIdSet = new Set(
      invoiceLines.map((il) => il.invoice_id as string)
    );
    const { data: invoiceHeaders } = await db
      .schema("orchard")
      .from("invoices")
      .select("id, invoice_number, po_id")
      .in("id", [...invoiceIdSet]);

    for (const inv of invoiceHeaders ?? []) {
      if (!inv.po_id) continue;
      logActivity({
        poId: inv.po_id as string,
        action: "invoice_linked_to_receipts",
        description: `Invoice ${inv.invoice_number} linked to ${
          linkedReceiptLineIds.length
        } receipt line${linkedReceiptLineIds.length === 1 ? "" : "s"}`,
        actor: "Ryan Belanger",
        relatedRecordType: "invoice",
        relatedRecordId: inv.id as string,
      });
    }

    const primaryInvoice = (invoiceHeaders ?? [])[0];

    return NextResponse.json({
      success: true,
      invoiceNumber: primaryInvoice?.invoice_number ?? "",
      linksCreated: linkRows.length,
      receiptLinesMatched: linkedReceiptLineIds.length,
      skipped: skippedReceiptLineIds,
    });
  } catch (error) {
    console.error("Link invoice error:", error);
    return NextResponse.json(
      { error: `Failed to link invoice: ${formatError(error)}` },
      { status: 500 }
    );
  }
}
