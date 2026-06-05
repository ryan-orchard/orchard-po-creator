import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/supabase";

// Synthetic per-document receipt id for BMC rows (Bronze has no receipt header for BMC).
function syntheticReceiptId(source: string, sourceDocNo: string | null, fallback: string): string {
  const key = `hdr:${source}:${sourceDocNo ?? fallback}`;
  const h = crypto.createHash("sha1").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * GET /api/receipt-lines
 *
 * Returns all receipt lines from Silver (orchard_calcs.receipt_lines) joined with
 * statuses, items, POs, and invoice links. Includes both Stord and BMC sources.
 * Query params: status (optional) — filter by Open, Unmatched, Matched, Excluded, Review
 */
export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status");

    const [
      silverLinesRes,
      statusesRes,
      itemsRes,
      posRes,
      linksRes,
      invoiceLinesRes,
      invoicesRes,
    ] = await Promise.all([
      db.schema("orchard_calcs").from("receipt_lines").select("*"),
      db.schema("orchard_calcs").from("receipt_line_statuses").select("receipt_line_id, transfer_status, invoice_status, flag"),
      db.schema("org_config").from("items").select("id, sku"),
      db.schema("orchard").from("purchase_orders").select("id, po_number"),
      db.schema("orchard_calcs").from("receipt_line_invoice_line_links").select("receipt_line_id, invoice_line_id"),
      db.schema("orchard").from("invoice_lines").select("id, invoice_id"),
      db.schema("orchard").from("invoices").select("id, invoice_number"),
    ]);

    if (silverLinesRes.error) throw silverLinesRes.error;
    if (statusesRes.error) throw statusesRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (posRes.error) throw posRes.error;
    if (linksRes.error) throw linksRes.error;
    if (invoiceLinesRes.error) throw invoiceLinesRes.error;
    if (invoicesRes.error) throw invoicesRes.error;

    const silverLines = silverLinesRes.data ?? [];
    const statusByLineId = new Map((statusesRes.data ?? []).map((s) => [s.receipt_line_id, s]));
    const itemsById = new Map((itemsRes.data ?? []).map((i) => [i.id, i]));
    const posById = new Map((posRes.data ?? []).map((p) => [p.id, p]));

    // Stord click-through still expects the Bronze receipt id. Look it up.
    const stordLineIds = silverLines.filter((l) => l.source === "stord").map((l) => l.id as string);
    const bronzeReceiptByLineId = new Map<string, string>();
    if (stordLineIds.length > 0) {
      const { data: bronzeLines } = await db.schema("orchard").from("receipt_lines")
        .select("id, receipt_id").in("id", stordLineIds);
      for (const b of bronzeLines ?? []) bronzeReceiptByLineId.set(b.id as string, b.receipt_id as string);
    }

    // receipt_line_id → first linked invoice
    const invoiceLineToInvoiceId = new Map((invoiceLinesRes.data ?? []).map((il) => [il.id, il.invoice_id]));
    const invoicesById = new Map((invoicesRes.data ?? []).map((i) => [i.id, i]));
    const invoiceByReceiptLineId = new Map<string, { id: string; number: string }>();
    for (const link of linksRes.data ?? []) {
      if (invoiceByReceiptLineId.has(link.receipt_line_id)) continue;
      const invoiceId = invoiceLineToInvoiceId.get(link.invoice_line_id);
      if (!invoiceId) continue;
      const invoice = invoicesById.get(invoiceId);
      if (!invoice) continue;
      invoiceByReceiptLineId.set(link.receipt_line_id, {
        id: invoice.id as string,
        number: invoice.invoice_number as string,
      });
    }

    // Counts (over all lines, before filter)
    const counts = { unmatched: 0, matched: 0, excluded: 0 };
    for (const line of silverLines) {
      const s = statusByLineId.get(line.id as string);
      if (s?.flag === "excluded") counts.excluded++;
      else if (s?.transfer_status === "matched" || s?.invoice_status === "matched") counts.matched++;
      else counts.unmatched++;
    }

    // Filter by status param
    let filtered = silverLines;
    if (status) {
      const f = status.toLowerCase();
      filtered = filtered.filter((l) => {
        const s = statusByLineId.get(l.id as string);
        if (f === "excluded") return s?.flag === "excluded";
        if (f === "matched") return s?.transfer_status === "matched" || s?.invoice_status === "matched";
        return !s || (s.transfer_status === "unmatched" && s.invoice_status === "unmatched" && !s.flag);
      });
    }

    const lines = filtered.map((line) => {
      const item = line.item_id ? itemsById.get(line.item_id) : null;
      const po = line.po_id ? posById.get(line.po_id) : null;
      const invoice = invoiceByReceiptLineId.get(line.id as string) ?? null;
      const receiptId = line.source === "stord"
        ? bronzeReceiptByLineId.get(line.id as string) ?? syntheticReceiptId(line.source, line.source_doc_no, line.id as string)
        : syntheticReceiptId(line.source, line.source_doc_no, line.id as string);
      const s = statusByLineId.get(line.id as string);

      return {
        id: line.id,
        receiptId,
        date: line.received_date,
        warehouse: line.warehouse_code,
        item: item?.sku ?? line.three_pl_sku ?? "Unknown",
        itemId: line.item_id ?? null,
        threePlSku: line.three_pl_sku ?? null,
        qty: line.qty_received,
        orderRef: line.source_doc_no,
        poNumber: po?.po_number ?? null,
        stordReceiptId: null,
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.number ?? null,
        transferStatus: s?.transfer_status ?? "unmatched",
        invoiceStatus: s?.invoice_status ?? "unmatched",
        flag: s?.flag ?? null,
        source: line.source,
      };
    });

    lines.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    return NextResponse.json({ lines, counts });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch receipt lines: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}
