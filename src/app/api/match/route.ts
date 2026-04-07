import { NextRequest, NextResponse } from "next/server";
import {
  getRecord,
  getRecords,
  updateRecord,
  createRecord,
  fetchInBatches,
  TABLES,
} from "@/lib/airtable";

// ── Types ────────────────────────────────────────────────────────────────────

export interface MatchInvoiceLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  ansItemNumber: string;
  description: string;
  qtyBilled: number;
  unitCost: number;
  amount: number;
  linkedReceiptLineId: string | null;
}

export interface MatchPOLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  qtyOrdered: number;
  unitCost: number;
  costBasis: string;
}

export interface MatchWOLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  lineType: "Input" | "Output";
  qty: number;
}

export interface MatchReceiptLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  qtyReceived: number;
}

export interface MatchReceipt {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  lines: MatchReceiptLine[];
}

export interface CheckStripRow {
  skuName: string;
  invoiceQty: number | null;
  invoicePrice: number | null;
  poQty: number | null;
  poPrice: number | null;
  receiptQty: number | null;
  priceMatch: boolean | null;
  qtyMatch: boolean | null;
}

export interface MatchPayload {
  invoice: {
    id: string;
    invoiceNumber: string;
    invoiceDate: string;
    supplier: string;
    supplierId: string | null;
    invoiceType: string;
    salesOrder: string;
    poReference: string;
    paymentTerms: string;
    trackingNumber: string;
    shipTo: string;
    subtotal: number;
    freight: number;
    tax: number;
    invoiceAmount: number;
    matchStatus: string;
    paymentStatus: string;
    notes: string;
    lines: MatchInvoiceLine[];
  };
  po: {
    id: string;
    poNumber: string;
    status: string;
    supplier: string;
    lines: MatchPOLine[];
  } | null;
  wo: {
    id: string;
    woNumber: string;
    status: string;
    description: string;
    lines: MatchWOLine[];
  } | null;
  receipts: MatchReceipt[];
  checkStrip: CheckStripRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeCheckStrip(
  invoiceLines: MatchInvoiceLine[],
  poLines: MatchPOLine[],
  receipts: MatchReceipt[]
): CheckStripRow[] {
  const allSkuIds = new Set<string>();
  invoiceLines.forEach((l) => l.skuId && allSkuIds.add(l.skuId));
  poLines.forEach((l) => l.skuId && allSkuIds.add(l.skuId));
  receipts.flatMap((r) => r.lines).forEach((l) => l.skuId && allSkuIds.add(l.skuId));

  const invoiceMap = new Map<string, { qty: number; price: number; name: string }>();
  for (const l of invoiceLines) {
    if (!l.skuId) continue;
    const existing = invoiceMap.get(l.skuId);
    if (existing) {
      existing.qty += l.qtyBilled;
    } else {
      invoiceMap.set(l.skuId, { qty: l.qtyBilled, price: l.unitCost, name: l.skuName || l.skuId });
    }
  }

  const poMap = new Map<string, { qty: number; price: number; name: string }>();
  for (const l of poLines) {
    if (!l.skuId) continue;
    poMap.set(l.skuId, { qty: l.qtyOrdered, price: l.unitCost, name: l.skuName || l.skuId });
  }

  const receiptMap = new Map<string, { qty: number; name: string }>();
  for (const r of receipts) {
    for (const l of r.lines) {
      if (!l.skuId) continue;
      const existing = receiptMap.get(l.skuId);
      if (existing) {
        existing.qty += l.qtyReceived;
      } else {
        receiptMap.set(l.skuId, { qty: l.qtyReceived, name: l.skuName || l.skuId });
      }
    }
  }

  const rows: CheckStripRow[] = [];
  for (const skuId of allSkuIds) {
    const inv = invoiceMap.get(skuId) ?? null;
    const po = poMap.get(skuId) ?? null;
    const rec = receiptMap.get(skuId) ?? null;
    const skuName = inv?.name || po?.name || rec?.name || skuId;
    const priceMatch = inv && po ? Math.abs(inv.price - po.price) < 0.001 : null;
    const compareQty = rec?.qty ?? po?.qty ?? null;
    const qtyMatch = inv && compareQty !== null ? inv.qty === compareQty : null;
    rows.push({
      skuName,
      invoiceQty: inv?.qty ?? null,
      invoicePrice: inv?.price ?? null,
      poQty: po?.qty ?? null,
      poPrice: po?.price ?? null,
      receiptQty: rec?.qty ?? null,
      priceMatch,
      qtyMatch,
    });
  }

  return rows.sort((a, b) => a.skuName.localeCompare(b.skuName));
}

// ── GET /api/match?from=invoice&id=<recordId> ─────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "invoice";
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (from !== "invoice") return NextResponse.json({ error: "Only from=invoice is supported" }, { status: 400 });

  try {
    const invoiceRecord = await getRecord(TABLES.INVOICES, id);
    if (!invoiceRecord?.fields) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    const f = invoiceRecord.fields;

    // Supplier name
    const supplierIds = f["Supplier"] as string[] | undefined;
    const supplierId = supplierIds?.[0] ?? null;
    let supplierName = "";
    if (supplierId) {
      const s = await getRecord(TABLES.SUPPLIERS, supplierId);
      supplierName = (s.fields["Supplier Name"] as string) || "";
    }

    // All SKUs (needed for line resolution)
    const allSkus = await getRecords(TABLES.SKUS);
    const skuMap = new Map(allSkus.map((s) => [s.id, s.fields["Standard SKU"] as string]));
    const uomMap = new Map(allSkus.map((s) => [s.id, s.fields["UOM"] as string]));

    // Invoice lines (also check for linked receipt lines)
    const invoiceLineIds = (f["Invoice Lines"] as string[]) || [];
    const rawInvoiceLines = await fetchInBatches(invoiceLineIds, (lid) =>
      getRecord(TABLES.INVOICE_LINES, lid)
    );

    const invoiceLines: MatchInvoiceLine[] = rawInvoiceLines.map((l) => {
      const lf = l.fields;
      const skuId = (lf["SKU"] as string[])?.[0] ?? null;
      const linkedReceiptLineId = (lf["Receipt Line"] as string[])?.[0] ?? null;
      return {
        id: l.id,
        skuId,
        skuName: skuId ? skuMap.get(skuId) ?? null : null,
        ansItemNumber: (lf["ANS Item Number"] as string) || "",
        description: (lf["Description"] as string) || "",
        qtyBilled: (lf["Qty Billed"] as number) || 0,
        unitCost: (lf["Unit Cost"] as number) || 0,
        amount: (lf["Amount"] as number) || 0,
        linkedReceiptLineId,
      };
    });

    // ── Linked PO ────────────────────────────────────────────────────────────
    const poLink = (f["Purchase Order"] as string[])?.[0] ?? null;
    let po: MatchPayload["po"] = null;
    let poLines: MatchPOLine[] = [];

    if (poLink) {
      const [poRecord, poSupplierRecord] = await (async () => {
        const poRec = await getRecord(TABLES.PURCHASE_ORDERS, poLink);
        const psIds = (poRec.fields["Supplier"] as string[]) || [];
        const psRec = psIds[0] ? await getRecord(TABLES.SUPPLIERS, psIds[0]) : null;
        return [poRec, psRec];
      })();

      const poLineIds = (poRecord.fields["PO Line Items"] as string[]) || [];
      const rawPOLines = await fetchInBatches(poLineIds, (lid) =>
        getRecord(TABLES.PO_LINE_ITEMS, lid)
      );

      poLines = rawPOLines.map((l) => {
        const lf = l.fields;
        const skuId = (lf["SKU"] as string[])?.[0] ?? null;
        const uom = skuId ? uomMap.get(skuId) ?? "Each" : "Each";
        const qtyOrdered =
          uom === "Carton" ? ((lf["Qty Cartons"] as number) || 0) : ((lf["Qty Sticks"] as number) || 0);
        return {
          id: l.id,
          skuId,
          skuName: skuId ? skuMap.get(skuId) ?? null : null,
          qtyOrdered,
          unitCost: (lf["Unit Cost"] as number) || 0,
          costBasis: (lf["Cost Basis"] as string) || "",
        };
      });

      po = {
        id: poRecord.id,
        poNumber: (poRecord.fields["PO Number"] as string) || "",
        status: (poRecord.fields["Status"] as string) || "",
        supplier: (poSupplierRecord?.fields["Supplier Name"] as string) || "",
        lines: poLines,
      };
    }

    // ── Linked Work Order ─────────────────────────────────────────────────────
    const woIds = (f["Work Orders"] as string[]) || [];
    const woLink = woIds[0] ?? null;
    let wo: MatchPayload["wo"] = null;

    if (woLink) {
      const woRecord = await getRecord(TABLES.WORK_ORDERS, woLink);
      const woLineIds = (woRecord.fields["Work Order Lines"] as string[]) || [];
      const rawWOLines = await fetchInBatches(woLineIds, (lid) =>
        getRecord(TABLES.WORK_ORDER_LINES, lid)
      );

      const woLines: MatchWOLine[] = rawWOLines.map((l) => {
        const lf = l.fields;
        const skuId = (lf["SKU"] as string[])?.[0] ?? null;
        return {
          id: l.id,
          skuId,
          skuName: skuId ? skuMap.get(skuId) ?? null : null,
          lineType: (lf["Line Type"] as "Input" | "Output") || "Output",
          qty: (lf["Quantity"] as number) || 0,
        };
      });

      wo = {
        id: woRecord.id,
        woNumber: (woRecord.fields["WO Number"] as string) || "",
        status: (woRecord.fields["Status"] as string) || "",
        description: (woRecord.fields["Notes"] as string) || "",
        lines: woLines,
      };
    }

    // ── Receipts ──────────────────────────────────────────────────────────────
    // Path 1: via PO link
    // Path 2: via WO link
    // Path 3: via Invoice Line → Receipt Line (direct line-level match, no PO/WO)
    let receipts: MatchReceipt[] = [];

    const buildReceiptLines = async (receiptIds: string[]): Promise<MatchReceipt[]> => {
      if (!receiptIds.length) return [];
      const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
      const linesByReceipt: Record<string, MatchReceiptLine[]> = {};
      for (const rl of allReceiptLines) {
        const rlReceiptId = (rl.fields["Receipt"] as string[])?.[0];
        if (!rlReceiptId || !receiptIds.includes(rlReceiptId)) continue;
        if (!linesByReceipt[rlReceiptId]) linesByReceipt[rlReceiptId] = [];
        const skuId = (rl.fields["SKU"] as string[])?.[0] ?? null;
        linesByReceipt[rlReceiptId].push({
          id: rl.id,
          skuId,
          skuName: skuId ? skuMap.get(skuId) ?? null : null,
          qtyReceived: (rl.fields["Qty Received"] as number) || 0,
        });
      }
      return receiptIds
        .map((rid) => {
          const r = allReceiptLines.find(() => false); // placeholder; we fetch below
          return { id: rid, linesByReceipt: linesByReceipt[rid] || [] };
        })
        .map(({ id: rid, linesByReceipt: lines }) => ({
          id: rid,
          receiptNumber: "",
          receivedDate: "",
          lines,
        }));
    };

    if (poLink) {
      const allReceipts = await getRecords(TABLES.RECEIPTS);
      const poReceipts = allReceipts.filter(
        (r) => (r.fields["Purchase Order"] as string[])?.[0] === poLink
      );
      const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
      const linesByReceipt: Record<string, MatchReceiptLine[]> = {};
      for (const rl of allReceiptLines) {
        const rlReceiptId = (rl.fields["Receipt"] as string[])?.[0];
        if (!rlReceiptId || !poReceipts.some((r) => r.id === rlReceiptId)) continue;
        if (!linesByReceipt[rlReceiptId]) linesByReceipt[rlReceiptId] = [];
        const skuId = (rl.fields["SKU"] as string[])?.[0] ?? null;
        linesByReceipt[rlReceiptId].push({
          id: rl.id,
          skuId,
          skuName: skuId ? skuMap.get(skuId) ?? null : null,
          qtyReceived: (rl.fields["Qty Received"] as number) || 0,
        });
      }
      receipts = poReceipts.map((r) => ({
        id: r.id,
        receiptNumber: (r.fields["Receipt Number"] as string) || "",
        receivedDate: (r.fields["Received Date"] as string) || "",
        lines: linesByReceipt[r.id] || [],
      }));
    } else if (woLink) {
      const allReceipts = await getRecords(TABLES.RECEIPTS);
      const woReceipts = allReceipts.filter(
        (r) => (r.fields["Work Order"] as string[])?.[0] === woLink
      );
      const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
      const linesByReceipt: Record<string, MatchReceiptLine[]> = {};
      for (const rl of allReceiptLines) {
        const rlReceiptId = (rl.fields["Receipt"] as string[])?.[0];
        if (!rlReceiptId || !woReceipts.some((r) => r.id === rlReceiptId)) continue;
        if (!linesByReceipt[rlReceiptId]) linesByReceipt[rlReceiptId] = [];
        const skuId = (rl.fields["SKU"] as string[])?.[0] ?? null;
        linesByReceipt[rlReceiptId].push({
          id: rl.id,
          skuId,
          skuName: skuId ? skuMap.get(skuId) ?? null : null,
          qtyReceived: (rl.fields["Qty Received"] as number) || 0,
        });
      }
      receipts = woReceipts.map((r) => ({
        id: r.id,
        receiptNumber: (r.fields["Receipt Number"] as string) || "",
        receivedDate: (r.fields["Received Date"] as string) || "",
        lines: linesByReceipt[r.id] || [],
      }));
    } else {
      // No PO or WO — find receipts via Invoice Line → Receipt Line links
      const linkedReceiptLineIds = invoiceLines
        .map((l) => l.linkedReceiptLineId)
        .filter(Boolean) as string[];

      if (linkedReceiptLineIds.length > 0) {
        const receiptLineRecords = await fetchInBatches(linkedReceiptLineIds, (lid) =>
          getRecord(TABLES.RECEIPT_LINES, lid)
        );
        const linkedReceiptIds = [
          ...new Set(
            receiptLineRecords
              .map((rl) => (rl.fields["Receipt"] as string[])?.[0])
              .filter(Boolean) as string[]
          ),
        ];
        if (linkedReceiptIds.length > 0) {
          const receiptRecords = await fetchInBatches(linkedReceiptIds, (rid) =>
            getRecord(TABLES.RECEIPTS, rid)
          );
          const linesByReceipt: Record<string, MatchReceiptLine[]> = {};
          for (const rl of receiptLineRecords) {
            const rlReceiptId = (rl.fields["Receipt"] as string[])?.[0];
            if (!rlReceiptId) continue;
            if (!linesByReceipt[rlReceiptId]) linesByReceipt[rlReceiptId] = [];
            const skuId = (rl.fields["SKU"] as string[])?.[0] ?? null;
            linesByReceipt[rlReceiptId].push({
              id: rl.id,
              skuId,
              skuName: skuId ? skuMap.get(skuId) ?? null : null,
              qtyReceived: (rl.fields["Qty Received"] as number) || 0,
            });
          }
          receipts = receiptRecords.map((r) => ({
            id: r.id,
            receiptNumber: (r.fields["Receipt Number"] as string) || "",
            receivedDate: (r.fields["Received Date"] as string) || "",
            lines: linesByReceipt[r.id] || [],
          }));
        }
      }
    }

    // Suppress unused helper
    void buildReceiptLines;

    const checkStrip = computeCheckStrip(invoiceLines, poLines, receipts);

    const payload: MatchPayload = {
      invoice: {
        id: invoiceRecord.id,
        invoiceNumber: (f["Invoice Number"] as string) || "",
        invoiceDate: (f["Invoice Date"] as string) || "",
        supplier: supplierName,
        supplierId,
        invoiceType: (f["Type"] as string) || "Supplier",
        salesOrder: (f["Sales Order"] as string) || "",
        poReference: (f["PO Reference"] as string) || "",
        paymentTerms: (f["Payment Terms"] as string) || "",
        trackingNumber: (f["Tracking Number"] as string) || "",
        shipTo: (f["Ship To"] as string) || "",
        subtotal: (f["Subtotal"] as number) || 0,
        freight: (f["Freight"] as number) || 0,
        tax: (f["Tax"] as number) || 0,
        invoiceAmount: (f["Total Amount"] as number) || 0,
        matchStatus: (f["Status"] as string) || "Open",
        paymentStatus: (f["Payment Status"] as string) || "Unpaid",
        notes: (f["Notes"] as string) || "",
        lines: invoiceLines,
      },
      po,
      wo,
      receipts,
      checkStrip,
    };

    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/match error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── PATCH /api/match?from=invoice&id=<recordId> ───────────────────────────────

export async function PATCH(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "invoice";
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (from !== "invoice") return NextResponse.json({ error: "Only from=invoice supported" }, { status: 400 });

  const body = await request.json() as { action: string; poId?: string; woId?: string; reason?: string };
  const { action } = body;

  const logEvent = async (eventType: string, details?: Record<string, unknown>) => {
    try {
      await createRecord(TABLES.EVENTS, {
        "Record Type": "Invoice",
        "Record ID": id,
        "Event Type": eventType,
        "Method": "manual",
        ...(details ? { "Details": JSON.stringify(details) } : {}),
        "Timestamp": new Date().toISOString(),
      });
    } catch {
      // non-fatal
    }
  };

  try {
    if (action === "link-po") {
      const { poId } = body;
      if (!poId) return NextResponse.json({ error: "Missing poId" }, { status: 400 });
      await updateRecord(TABLES.INVOICES, id, { "Purchase Order": [poId] });
      await logEvent("link", { linked: "PO", poId });
      return NextResponse.json({ ok: true });
    }

    if (action === "unlink-po") {
      await updateRecord(TABLES.INVOICES, id, { "Purchase Order": [] });
      await logEvent("unlink", { unlinked: "PO" });
      return NextResponse.json({ ok: true });
    }

    if (action === "link-wo") {
      const { woId } = body;
      if (!woId) return NextResponse.json({ error: "Missing woId" }, { status: 400 });
      await updateRecord(TABLES.INVOICES, id, { "Work Orders": [woId] });
      await logEvent("link", { linked: "WO", woId });
      return NextResponse.json({ ok: true });
    }

    if (action === "unlink-wo") {
      await updateRecord(TABLES.INVOICES, id, { "Work Orders": [] });
      await logEvent("unlink", { unlinked: "WO" });
      return NextResponse.json({ ok: true });
    }

    if (action === "confirm") {
      await updateRecord(TABLES.INVOICES, id, { "Status": "Matched" });

      // Update Invoice Match on receipt lines for all linked receipts
      const invoiceRecord = await getRecord(TABLES.INVOICES, id);
      const poLink = (invoiceRecord.fields["Purchase Order"] as string[])?.[0];
      const woLink = (invoiceRecord.fields["Work Orders"] as string[])?.[0];

      const sourceLink = poLink || woLink;
      if (sourceLink) {
        const allReceipts = await getRecords(TABLES.RECEIPTS);
        const linkedReceipts = allReceipts.filter((r) => {
          if (poLink) return (r.fields["Purchase Order"] as string[])?.[0] === poLink;
          if (woLink) return (r.fields["Work Order"] as string[])?.[0] === woLink;
          return false;
        });
        const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);
        const updates = allReceiptLines.filter((rl) => {
          const rlReceiptId = (rl.fields["Receipt"] as string[])?.[0];
          return linkedReceipts.some((r) => r.id === rlReceiptId);
        });
        for (const rl of updates) {
          await updateRecord(TABLES.RECEIPT_LINES, rl.id, { "Invoice Match": "Linked" });
        }
      }

      await logEvent("match_confirmed");
      return NextResponse.json({ ok: true });
    }

    if (action === "flag-discrepancy") {
      await updateRecord(TABLES.INVOICES, id, { "Status": "Discrepancy" });
      await logEvent("flag_discrepancy", body.reason ? { reason: body.reason } : undefined);
      return NextResponse.json({ ok: true });
    }

    if (action === "exclude") {
      await updateRecord(TABLES.INVOICES, id, { "Status": "Open" }); // no "Excluded" status — keep Open
      await logEvent("excluded");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("PATCH /api/match error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
