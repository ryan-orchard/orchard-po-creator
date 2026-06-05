import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

// ─── helpers ─────────────────────────────────────────────────────────────────

function normalize(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

// ─── types ───────────────────────────────────────────────────────────────────

interface InvoiceCost {
  invoiceId: string;
  invoiceNumber: string;
  unitCost: number;
  overheadPerUnit: number;
  landedUnitCost: number;
}

interface InvoiceSuggestion extends InvoiceCost {
  invoiceLineId: string;
  confidence: "high" | "medium" | "low";
}

interface TransferSummary {
  transferId: string;
  transferNumber: string;
  totalShippedQty: number;
  totalReceivedQty: number;
}

interface ReceiptLineDetail {
  id: string;
  sku: string | null;
  itemId: string | null;
  qtyReceived: number;
  lotNumber: string | null;
  threePlSku: string | null;
  transferStatus: string;
  invoiceStatus: string;
  linkedInvoice: InvoiceCost | null;
  suggestedInvoice: InvoiceSuggestion | null;
}

// ─── computeOverheadPerUnit ──────────────────────────────────────────────────
// Overhead (freight + tax on invoice header) allocated by total product qty
// across all product lines on that invoice.

function computeOverheadPerUnit(
  invoiceId: string,
  invoiceOverheads: Map<string, { freight: number; tax: number }>,
  invoiceLineQtys: Map<string, number>, // invoiceId → total product qty
): number {
  const overhead = invoiceOverheads.get(invoiceId);
  if (!overhead) return 0;
  const total = (overhead.freight || 0) + (overhead.tax || 0);
  if (total === 0) return 0;
  const productQty = invoiceLineQtys.get(invoiceId) ?? 0;
  if (productQty === 0) return 0;
  return total / productQty;
}

// ─── GET /api/receipts/[id] ──────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sourceParam = request.nextUrl.searchParams.get("source");
  const docParam = request.nextUrl.searchParams.get("doc");

  try {
    // Receipt metadata and silver lines — two paths:
    //   1. Non-bronze source (BMC etc): use ?source=X&doc=Y query params
    //   2. Stord: look up bronze header by ID, then fetch silver by source_doc_no

    type SilverLineRow = {
      id: string;
      item_id: string | null;
      qty_received: number;
      lot_number: string | null;
      three_pl_sku: string | null;
      po_id: string | null;
    };

    let receiptMeta: {
      id: string;
      receiptNumber: string | null;
      receivedDate: string | null;
      externalReceiptId: string | null;
      warehouse: string | null;
      notes: string | null;
    };
    let lines: SilverLineRow[];

    if (sourceParam && docParam) {
      // ── Non-bronze path (BMC, etc.) ──────────────────────────
      const { data: silverLines } = await db
        .schema("orchard_calcs")
        .from("receipt_lines")
        .select("id, item_id, qty_received, lot_number, three_pl_sku, po_id, received_date, warehouse_code")
        .eq("source", sourceParam)
        .eq("source_doc_no", docParam);

      lines = (silverLines ?? []).map(l => ({
        id: l.id as string,
        item_id: (l.item_id as string) ?? null,
        qty_received: Number(l.qty_received) || 0,
        lot_number: (l.lot_number as string) ?? null,
        three_pl_sku: (l.three_pl_sku as string) ?? null,
        po_id: (l.po_id as string) ?? null,
      }));

      const firstLine = silverLines?.[0];
      receiptMeta = {
        id,
        receiptNumber: null,
        receivedDate: (firstLine?.received_date as string) ?? null,
        externalReceiptId: docParam,
        warehouse: (firstLine?.warehouse_code as string) ?? sourceParam.toUpperCase(),
        notes: null,
      };
    } else {
      // ── Bronze/Stord path ────────────────────────────────────
      const { data: receipt, error: rErr } = await db
        .schema("orchard")
        .from("receipts")
        .select("id, receipt_number, received_date, external_id, location_id, notes")
        .eq("id", id)
        .single();
      if (rErr || !receipt) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
      }

      const { data: loc } = receipt.location_id
        ? await db
            .schema("org_config")
            .from("locations")
            .select("code, name")
            .eq("id", receipt.location_id as string)
            .single()
        : { data: null };

      receiptMeta = {
        id: receipt.id as string,
        receiptNumber: receipt.receipt_number as string,
        receivedDate: receipt.received_date as string,
        externalReceiptId: (receipt.external_id as string) ?? null,
        warehouse: loc ? ((loc.code ?? loc.name) as string) : null,
        notes: (receipt.notes as string) ?? null,
      };

      const { data: silverLines } = receipt.external_id
        ? await db
            .schema("orchard_calcs")
            .from("receipt_lines")
            .select("id, item_id, qty_received, lot_number, three_pl_sku, po_id")
            .eq("source_doc_no", receipt.external_id as string)
            .eq("source", "stord")
        : { data: [] };

      lines = (silverLines ?? []).map(l => ({
        id: l.id as string,
        item_id: (l.item_id as string) ?? null,
        qty_received: Number(l.qty_received) || 0,
        lot_number: (l.lot_number as string) ?? null,
        three_pl_sku: (l.three_pl_sku as string) ?? null,
        po_id: (l.po_id as string) ?? null,
      }));
    }

    const lineIds = lines.map((l) => l.id);

    if (lineIds.length === 0) {
      return NextResponse.json({
        id: receiptMeta.id,
        receiptNumber: receiptMeta.receiptNumber,
        receivedDate: receiptMeta.receivedDate,
        externalReceiptId: receiptMeta.externalReceiptId,
        warehouse: receiptMeta.warehouse,
        notes: receiptMeta.notes,
        transfers: [],
        lines: [],
        matchedLineCount: 0,
        unmatchedLineCount: 0,
      });
    }

    // 4. Resolve SKUs
    const itemIds = [...new Set(lines.map((l) => l.item_id as string).filter(Boolean))];
    const { data: items } = itemIds.length
      ? await db.schema("org_config").from("items").select("id, sku").in("id", itemIds)
      : { data: [] };
    const skuMap = new Map((items ?? []).map((i) => [i.id as string, i.sku as string]));

    // 5. Statuses
    const { data: statusRows } = await db
      .schema("orchard_calcs")
      .from("receipt_line_statuses")
      .select("receipt_line_id, transfer_status, invoice_status")
      .in("receipt_line_id", lineIds);
    const statusMap = new Map(
      (statusRows ?? []).map((s) => [
        s.receipt_line_id as string,
        {
          transferStatus: (s.transfer_status as string) ?? "unmatched",
          invoiceStatus: (s.invoice_status as string) ?? "unmatched",
        },
      ]),
    );

    // 6. Invoice links (matched lines)
    const { data: invoiceLinkRows } = await db
      .schema("orchard_calcs")
      .from("receipt_line_invoice_line_links")
      .select("receipt_line_id, invoice_line_id")
      .in("receipt_line_id", lineIds);
    // receipt_line_id → first invoice_line_id (one invoice per line is the common case)
    const invoiceLinkMap = new Map<string, string>();
    for (const link of invoiceLinkRows ?? []) {
      if (!invoiceLinkMap.has(link.receipt_line_id as string)) {
        invoiceLinkMap.set(link.receipt_line_id as string, link.invoice_line_id as string);
      }
    }

    // 7. Load invoice lines + headers for matched lines
    const linkedInvoiceLineIds = [...new Set((invoiceLinkRows ?? []).map((l) => l.invoice_line_id as string))];
    type InvoiceLineRow = { id: string; invoice_id: string; item_id: string | null; unit_price: number; qty: number };
    const { data: linkedInvLines } = linkedInvoiceLineIds.length
      ? await db
          .schema("orchard")
          .from("invoice_lines")
          .select("id, invoice_id, item_id, unit_price, qty")
          .in("id", linkedInvoiceLineIds)
      : { data: [] as InvoiceLineRow[] };
    const invLineMap = new Map((linkedInvLines ?? []).map((l) => [l.id as string, l as InvoiceLineRow]));

    const linkedInvoiceIds = [...new Set((linkedInvLines ?? []).map((l) => (l as InvoiceLineRow).invoice_id))];
    type InvoiceRow = { id: string; invoice_number: string; freight: number | null; tax: number | null };
    const { data: linkedInvoices } = linkedInvoiceIds.length
      ? await db
          .schema("orchard")
          .from("invoices")
          .select("id, invoice_number, freight, tax")
          .in("id", linkedInvoiceIds)
      : { data: [] as InvoiceRow[] };
    const invoiceHeaderMap = new Map((linkedInvoices ?? []).map((inv) => [inv.id as string, inv as InvoiceRow]));

    // 8. Total product qty per invoice (for overhead allocation)
    // Load all lines for these invoices (not just the matched ones)
    const { data: allInvLinesForOverhead } = linkedInvoiceIds.length
      ? await db
          .schema("orchard")
          .from("invoice_lines")
          .select("invoice_id, item_id, qty")
          .in("invoice_id", linkedInvoiceIds)
      : { data: [] };

    const invoiceOverheads = new Map<string, { freight: number; tax: number }>(
      (linkedInvoices ?? []).map((inv) => [
        inv.id as string,
        { freight: Number((inv as InvoiceRow).freight) || 0, tax: Number((inv as InvoiceRow).tax) || 0 },
      ]),
    );
    const invoiceLineQtys = new Map<string, number>();
    for (const l of allInvLinesForOverhead ?? []) {
      if (!l.item_id) continue; // skip overhead-only lines
      const cur = invoiceLineQtys.get(l.invoice_id as string) ?? 0;
      invoiceLineQtys.set(l.invoice_id as string, cur + (Number(l.qty) || 0));
    }

    // 9. Transfer links (informational)
    const { data: transferLinkRows } = await db
      .schema("orchard_calcs")
      .from("transfer_line_receipt_line_links")
      .select("receipt_line_id, transfer_line_id, matched_qty")
      .in("receipt_line_id", lineIds);

    const tLineIds = [...new Set((transferLinkRows ?? []).map((l) => l.transfer_line_id as string))];
    type TLineRow = { id: string; transfer_id: string; shipped_qty: number };
    const { data: tLines } = tLineIds.length
      ? await db.schema("orchard").from("transfer_lines").select("id, transfer_id, shipped_qty").in("id", tLineIds)
      : { data: [] as TLineRow[] };
    const tLineMap = new Map((tLines ?? []).map((l) => [l.id as string, l as TLineRow]));

    const transferIds = [...new Set((tLines ?? []).map((l) => (l as TLineRow).transfer_id))];
    type TransferRow = { id: string; transfer_number: string };
    const { data: transferRows } = transferIds.length
      ? await db.schema("orchard").from("transfers").select("id, transfer_number").in("id", transferIds)
      : { data: [] as TransferRow[] };
    const transferMap = new Map((transferRows ?? []).map((t) => [t.id as string, t as TransferRow]));

    // Roll up transfers: transfer_id → { shippedQty, receivedQty }
    const transferRollup = new Map<string, { shippedQty: number; receivedQty: number }>();
    for (const link of transferLinkRows ?? []) {
      const tLine = tLineMap.get(link.transfer_line_id as string);
      if (!tLine) continue;
      const cur = transferRollup.get(tLine.transfer_id) ?? { shippedQty: 0, receivedQty: 0 };
      cur.shippedQty += Number(tLine.shipped_qty) || 0;
      cur.receivedQty += Number(link.matched_qty) || 0;
      transferRollup.set(tLine.transfer_id, cur);
    }

    const transfers: TransferSummary[] = [];
    for (const [tId, qty] of transferRollup) {
      const t = transferMap.get(tId);
      if (!t) continue;
      transfers.push({
        transferId: tId,
        transferNumber: t.transfer_number,
        totalShippedQty: qty.shippedQty,
        totalReceivedQty: qty.receivedQty,
      });
    }

    // 10. Invoice suggestions for unmatched lines
    const unmatchedLines = lines.filter(
      (l) => (statusMap.get(l.id as string)?.invoiceStatus ?? "unmatched") === "unmatched",
    );
    const suggestions = new Map<string, InvoiceSuggestion>();

    if (unmatchedLines.length > 0) {
      const unmatchedItemIds = [...new Set(unmatchedLines.map((l) => l.item_id as string).filter(Boolean))];

      if (unmatchedItemIds.length > 0) {
        // Candidate invoice lines matching these item_ids
        type CandInvLine = { id: string; invoice_id: string; item_id: string | null; unit_price: number; qty: number };
        const { data: candLines } = await db
          .schema("orchard")
          .from("invoice_lines")
          .select("id, invoice_id, item_id, unit_price, qty")
          .in("item_id", unmatchedItemIds);

        const candInvoiceIds = [...new Set((candLines ?? []).map((l) => (l as CandInvLine).invoice_id))];

        if (candInvoiceIds.length > 0) {
          type CandInv = { id: string; invoice_number: string; supplier_id: string | null; po_reference: string | null; invoice_date: string | null; freight: number | null; tax: number | null };
          const [{ data: candInvoices }, { data: candStatuses }] = await Promise.all([
            db
              .schema("orchard")
              .from("invoices")
              .select("id, invoice_number, supplier_id, po_reference, invoice_date, freight, tax")
              .in("id", candInvoiceIds),
            db
              .schema("orchard_calcs")
              .from("invoice_statuses")
              .select("invoice_id, match_status")
              .in("invoice_id", candInvoiceIds),
          ]);

          const fullyMatchedIds = new Set(
            (candStatuses ?? []).filter((s) => s.match_status === "matched").map((s) => s.invoice_id as string),
          );
          const availableInvoices = new Map<string, CandInv>(
            (candInvoices ?? [])
              .filter((inv) => !fullyMatchedIds.has(inv.id as string))
              .map((inv) => [inv.id as string, inv as CandInv]),
          );

          // All product lines for candidate invoices (for overhead calc)
          const { data: candAllLines } = await db
            .schema("orchard")
            .from("invoice_lines")
            .select("invoice_id, item_id, qty")
            .in("invoice_id", [...availableInvoices.keys()]);

          const candInvoiceLineQtys = new Map<string, number>();
          for (const l of candAllLines ?? []) {
            if (!l.item_id) continue;
            const cur = candInvoiceLineQtys.get(l.invoice_id as string) ?? 0;
            candInvoiceLineQtys.set(l.invoice_id as string, cur + (Number(l.qty) || 0));
          }

          // PO context for ranking
          const poIds = [...new Set(unmatchedLines.map((l) => l.po_id as string).filter(Boolean))];
          const { data: poRows } = poIds.length
            ? await db
                .schema("orchard")
                .from("purchase_orders")
                .select("id, po_number, supplier_id")
                .in("id", poIds)
            : { data: [] };
          const poMap = new Map((poRows ?? []).map((p) => [p.id as string, p]));

          // Per-line suggestion
          for (const line of unmatchedLines) {
            if (!line.item_id) continue;

            const po = line.po_id ? poMap.get(line.po_id as string) : null;
            const poNumber = (po?.po_number as string) ?? "";
            const supplierId = (po?.supplier_id as string) ?? "";

            // Invoice lines for this item_id on available invoices
            const itemCandLines = (candLines ?? [])
              .filter(
                (cl) =>
                  (cl as CandInvLine).item_id === line.item_id &&
                  availableInvoices.has((cl as CandInvLine).invoice_id),
              ) as CandInvLine[];

            if (itemCandLines.length === 0) continue;

            // Score each
            const scored = itemCandLines.map((cl) => {
              const inv = availableInvoices.get(cl.invoice_id);
              if (!inv) return null;

              const normRef = inv.po_reference ? normalize(inv.po_reference) : "";
              const normPo = poNumber ? normalize(poNumber) : "";
              const poRefMatch =
                normRef !== "" && normPo !== ""
                  ? normRef.includes(normPo) || normPo.includes(normRef)
                  : false;
              const supplierMatch = supplierId !== "" && inv.supplier_id === supplierId;

              return {
                invoiceLineId: cl.id,
                invoiceId: cl.invoice_id,
                invoiceNumber: inv.invoice_number,
                unitCost: Number(cl.unit_price) || 0,
                invoiceDate: inv.invoice_date ?? "",
                freight: Number(inv.freight) || 0,
                tax: Number(inv.tax) || 0,
                poRefMatch,
                supplierMatch,
              };
            }).filter((x): x is NonNullable<typeof x> => x !== null);

            scored.sort((a, b) => {
              if (a.poRefMatch !== b.poRefMatch) return a.poRefMatch ? -1 : 1;
              if (a.supplierMatch !== b.supplierMatch) return a.supplierMatch ? -1 : 1;
              return (b.invoiceDate || "").localeCompare(a.invoiceDate || "");
            });

            const top = scored[0];
            if (!top) continue;

            const overhead = computeOverheadPerUnit(
              top.invoiceId,
              new Map([[top.invoiceId, { freight: top.freight, tax: top.tax }]]),
              candInvoiceLineQtys,
            );
            const confidence: "high" | "medium" | "low" = top.poRefMatch
              ? "high"
              : top.supplierMatch
                ? "medium"
                : "low";

            suggestions.set(line.id as string, {
              invoiceId: top.invoiceId,
              invoiceLineId: top.invoiceLineId,
              invoiceNumber: top.invoiceNumber,
              unitCost: top.unitCost,
              overheadPerUnit: round4(overhead),
              landedUnitCost: round4(top.unitCost + overhead),
              confidence,
            });
          }
        }
      }
    }

    // 11. Assemble lines
    const responseLines: ReceiptLineDetail[] = lines.map((l) => {
      const lineId = l.id as string;
      const status = statusMap.get(lineId) ?? { transferStatus: "unmatched", invoiceStatus: "unmatched" };

      let linkedInvoice: InvoiceCost | null = null;
      if (status.invoiceStatus === "matched") {
        const invLineId = invoiceLinkMap.get(lineId);
        if (invLineId) {
          const invLine = invLineMap.get(invLineId);
          if (invLine) {
            const inv = invoiceHeaderMap.get(invLine.invoice_id);
            if (inv) {
              const overhead = computeOverheadPerUnit(inv.id, invoiceOverheads, invoiceLineQtys);
              const unitCost = Number(invLine.unit_price) || 0;
              linkedInvoice = {
                invoiceId: inv.id,
                invoiceNumber: inv.invoice_number as string,
                unitCost,
                overheadPerUnit: round4(overhead),
                landedUnitCost: round4(unitCost + overhead),
              };
            }
          }
        }
      }

      return {
        id: lineId,
        sku: l.item_id ? (skuMap.get(l.item_id as string) ?? null) : null,
        itemId: (l.item_id as string) ?? null,
        qtyReceived: Number(l.qty_received) || 0,
        lotNumber: (l.lot_number as string) ?? null,
        threePlSku: (l.three_pl_sku as string) ?? null,
        transferStatus: status.transferStatus,
        invoiceStatus: status.invoiceStatus,
        linkedInvoice,
        suggestedInvoice: status.invoiceStatus === "unmatched" ? (suggestions.get(lineId) ?? null) : null,
      };
    });

    const matchedLineCount = responseLines.filter((l) => l.invoiceStatus === "matched").length;
    const unmatchedLineCount = responseLines.length - matchedLineCount;

    return NextResponse.json({
      id: receiptMeta.id,
      receiptNumber: receiptMeta.receiptNumber,
      receivedDate: receiptMeta.receivedDate,
      externalReceiptId: receiptMeta.externalReceiptId,
      warehouse: receiptMeta.warehouse,
      notes: receiptMeta.notes,
      transfers,
      lines: responseLines,
      matchedLineCount,
      unmatchedLineCount,
    });
  } catch (error) {
    console.error("Receipt GET error:", error);
    return NextResponse.json(
      { error: `Failed to get receipt: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, unknown> = {};
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.externalReceiptId !== undefined) updates.external_id = body.externalReceiptId;
  if (body.receivedDate !== undefined) updates.received_date = body.receivedDate;
  if (body.warehouseId !== undefined) updates.location_id = body.warehouseId || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { error } = await db.schema("orchard").from("receipts").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, id });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const { error } = await db.schema("orchard").from("receipts").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to delete: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}
