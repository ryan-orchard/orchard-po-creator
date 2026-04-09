import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/auth";
import { getRecord, getRecords, updateRecord, fetchInBatches, TABLES } from "@/lib/airtable";
import { logActivity } from "@/lib/activity-log";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MatchInvoiceLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  description: string;
  qtyBilled: number;
  unitCost: number;
  amount: number;
}

export interface MatchSourceDocLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  qtyOrdered: number;
  unitCost: number | null;
  costBasis: string | null;
}

export interface MatchReceiptLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  qtyReceived: number;
  sourceMatch: string | null;
  invoiceMatch: string | null;
}

export interface MatchReceipt {
  id: string;
  receiptNumber: string;
  receivedDate: string;
  warehouse: string | null;
  orderNumber: string | null;
  externalReceiptId: string | null;
  lines: MatchReceiptLine[];
}

export interface MatchSourceDoc {
  type: "po" | "wo";
  id: string;
  number: string;
  date: string;
  supplier: string | null;
  status: string;
  notes: string | null;
  location: string | null;
  lines: MatchSourceDocLine[];
}

export interface MatchInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string | null;
  totalAmount: number;
  status: string;
  paymentStatus: string;
  invoiceType: string;
  dueDate: string | null;
  paymentTerms: string | null;
  poReference: string | null;
  salesOrderNumber: string | null;
  notes: string | null;
  subtotal: number | null;
  freight: number | null;
  lines: MatchInvoiceLine[];
}

export interface CheckStripRow {
  skuId: string;
  skuName: string;
  agreedUnitCost: number | null;
  invoiceUnitCost: number | null;
  priceMatch: boolean | null;
  poQty: number | null;
  receivedQty: number | null;
  invoiceQty: number | null;
  qtyMatch: boolean | null;
}

export interface CandidateSourceDoc {
  type: "po" | "wo";
  id: string;
  number: string;
  date: string;
  supplier: string | null;
  status: string;
}

export interface CandidateInvoiceLine {
  id: string;
  skuId: string | null;
  skuName: string | null;
  description: string;
  qtyBilled: number;
  unitCost: number;
  amount: number;
}

export interface CandidateInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  supplier: string | null;
  totalAmount: number;
  invoiceType: string;
  status: string;
  skuIds: string[];
  poReference: string | null;
  lines: CandidateInvoiceLine[];
}

export interface MatchPayload {
  anchorType: "invoice" | "receipt";
  invoice: MatchInvoice | null;
  sourceDoc: MatchSourceDoc | null;
  receipts: {
    available: MatchReceipt[];
    linkedIds: string[];
    suggestedIds: string[];
  };
  candidateSourceDocs: CandidateSourceDoc[];
  candidateInvoices: CandidateInvoice[];
  checkStrip: CheckStripRow[];
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

type SkuMap = Map<string, { name: string; uom: string }>;

function buildSkuMap(allSkus: Awaited<ReturnType<typeof getRecords>>): SkuMap {
  return new Map(
    allSkus.map((s) => [
      s.id,
      {
        name:
          (s.fields["Standard SKU"] as string) ||
          (s.fields["Name"] as string) ||
          s.id,
        uom: (s.fields["UOM"] as string) || "Each",
      },
    ])
  );
}

function buildSupplierMap(allSuppliers: Awaited<ReturnType<typeof getRecords>>) {
  return new Map(
    allSuppliers.map((s) => [
      s.id,
      (s.fields["Supplier Name"] as string) ||
        (s.fields["Code"] as string) ||
        s.id,
    ])
  );
}

function buildWarehouseMap(allWarehouses: Awaited<ReturnType<typeof getRecords>>) {
  return new Map(
    allWarehouses.map((w) => [
      w.id,
      (w.fields["Code"] as string) || (w.fields["Name"] as string) || w.id,
    ])
  );
}

// ─────────────────────────────────────────────────────────────
// Data loaders
// ─────────────────────────────────────────────────────────────

async function loadInvoice(
  invoiceId: string,
  skuMap: SkuMap,
  supplierMap: Map<string, string>
): Promise<MatchInvoice | null> {
  const record = await getRecord(TABLES.INVOICES, invoiceId);
  if (!record?.id) return null;

  const lineIds = (record.fields["Invoice Lines"] as string[]) || [];
  const lineRecords = await fetchInBatches(lineIds, (lid) =>
    getRecord(TABLES.INVOICE_LINES, lid)
  );

  const supplierId = (record.fields["Supplier"] as string[])?.[0] ?? null;

  const lines: MatchInvoiceLine[] = lineRecords.filter(Boolean).map((l) => {
    const skuId = (l.fields["SKU"] as string[])?.[0] ?? null;
    return {
      id: l.id,
      skuId,
      skuName: skuId ? (skuMap.get(skuId)?.name ?? null) : null,
      description: (l.fields["Description"] as string) || "",
      qtyBilled: (l.fields["Qty Billed"] as number) || 0,
      unitCost: (l.fields["Unit Cost"] as number) || 0,
      amount: (l.fields["Amount"] as number) || 0,
    };
  });

  return {
    id: record.id,
    invoiceNumber: (record.fields["Invoice Number"] as string) || "",
    invoiceDate: (record.fields["Date"] as string) || "",
    supplier: supplierId ? (supplierMap.get(supplierId) ?? null) : null,
    totalAmount: (record.fields["Invoice Amount"] as number) || 0,
    status: (record.fields["Status"] as string) || "Open",
    paymentStatus: (record.fields["Payment Status"] as string) || "Unpaid",
    invoiceType: (record.fields["Invoice Type"] as string) || "Supplier",
    dueDate: (record.fields["Due Date"] as string) || null,
    paymentTerms: (record.fields["Payment Terms"] as string) || null,
    poReference: (record.fields["PO Reference"] as string) || null,
    salesOrderNumber: (record.fields["Sales Order"] as string) || null,
    notes: (record.fields["Notes"] as string) || null,
    subtotal: (record.fields["Subtotal"] as number) || null,
    freight: (record.fields["Freight"] as number) || null,
    lines,
  };
}

async function loadSourceDoc(
  poId: string | null,
  woId: string | null,
  skuMap: SkuMap,
  supplierMap: Map<string, string>,
  warehouseMap: Map<string, string>
): Promise<MatchSourceDoc | null> {
  if (poId) {
    const record = await getRecord(TABLES.PURCHASE_ORDERS, poId);
    if (!record?.id) return null;

    const allLineItems = await getRecords(TABLES.PO_LINE_ITEMS);
    const lineItems = allLineItems.filter(
      (li) => (li.fields["Purchase Order"] as string[])?.[0] === poId
    );

    const supplierId = (record.fields["Supplier"] as string[])?.[0] ?? null;

    const lines: MatchSourceDocLine[] = lineItems.map((li) => {
      const skuId = (li.fields["SKU"] as string[])?.[0] ?? null;
      const uom = skuId ? (skuMap.get(skuId)?.uom ?? "Each") : "Each";
      const qtyOrdered =
        uom === "Carton"
          ? (li.fields["Qty Cartons"] as number) || 0
          : (li.fields["Qty Sticks"] as number) ||
            (li.fields["Qty Cartons"] as number) ||
            0;
      return {
        id: li.id,
        skuId,
        skuName: skuId ? (skuMap.get(skuId)?.name ?? null) : null,
        qtyOrdered,
        unitCost: (li.fields["Unit Cost"] as number) ?? null,
        costBasis: (li.fields["Cost Basis"] as string) ?? null,
      };
    });

    return {
      type: "po",
      id: record.id,
      number: (record.fields["PO Number"] as string) || "",
      date: (record.fields["Date"] as string) || "",
      supplier: supplierId ? (supplierMap.get(supplierId) ?? null) : null,
      status: (record.fields["Status"] as string) || "",
      notes: (record.fields["Notes"] as string) || null,
      location: null,
      lines,
    };
  }

  if (woId) {
    const record = await getRecord(TABLES.WORK_ORDERS, woId);
    if (!record?.id) return null;

    const allWOLines = await getRecords(TABLES.WORK_ORDER_LINES);
    const woLines = allWOLines.filter(
      (l) =>
        (l.fields["Work Order"] as string[])?.[0] === woId &&
        (l.fields["Line Type"] as string) === "Output"
    );

    const lines: MatchSourceDocLine[] = woLines.map((l) => {
      const skuId = (l.fields["SKU"] as string[])?.[0] ?? null;
      return {
        id: l.id,
        skuId,
        skuName: skuId ? (skuMap.get(skuId)?.name ?? null) : null,
        qtyOrdered: (l.fields["Quantity"] as number) || 0,
        unitCost: null,
        costBasis: null,
      };
    });

    const locationIds = (record.fields["Location"] as string[]) || [];
    const locationId = locationIds[0] ?? null;
    const location = locationId ? (warehouseMap.get(locationId) ?? null) : null;

    return {
      type: "wo",
      id: record.id,
      number: (record.fields["WO Number"] as string) || "",
      date: (record.fields["Date"] as string) || (record.createdTime?.slice(0, 10) ?? ""),
      supplier: null,
      status: (record.fields["Status"] as string) || "",
      notes: (record.fields["Notes"] as string) || null,
      location,
      lines,
    };
  }

  return null;
}

async function loadReceiptsForSourceDoc(
  sourceDocId: string,
  sourceDocType: "po" | "wo",
  skuMap: SkuMap,
  warehouseMap: Map<string, string>
): Promise<MatchReceipt[]> {
  const allReceipts = await getRecords(TABLES.RECEIPTS);
  const relevantReceipts = allReceipts.filter((r) =>
    sourceDocType === "po"
      ? (r.fields["Purchase Order"] as string[])?.[0] === sourceDocId
      : (r.fields["Work Order"] as string[])?.[0] === sourceDocId
  );

  if (!relevantReceipts.length) return [];

  const allReceiptLines = await getRecords(TABLES.RECEIPT_LINES);

  return relevantReceipts.map((r) => {
    const whId = (r.fields["Warehouses"] as string[])?.[0] ?? null;

    const externalId = (r.fields["External Receipt ID"] as string) || "";
    const poRef = (r.fields["PO Reference"] as string) || "";
    const notes = (r.fields["Notes"] as string) || "";
    const notesMatch = notes.match(/^Order:\s*(.+?)(?:\s*\||\s*$)/);
    const orderNumber = poRef || (notesMatch ? notesMatch[1].trim() : externalId) || null;

    const lines: MatchReceiptLine[] = allReceiptLines
      .filter((rl) => (rl.fields["Receipt"] as string[])?.[0] === r.id)
      .map((rl) => {
        const skuId = (rl.fields["SKU"] as string[])?.[0] ?? null;
        return {
          id: rl.id,
          skuId,
          skuName: skuId ? (skuMap.get(skuId)?.name ?? null) : null,
          qtyReceived: (rl.fields["Qty Received"] as number) || 0,
          sourceMatch: (rl.fields["Source Match"] as string) ?? null,
          invoiceMatch: (rl.fields["Invoice Match"] as string) ?? null,
        };
      });

    return {
      id: r.id,
      receiptNumber: (r.fields["Receipt Number"] as string) || "",
      receivedDate: (r.fields["Received Date"] as string) || "",
      warehouse: whId ? (warehouseMap.get(whId) ?? null) : null,
      orderNumber,
      externalReceiptId: externalId || null,
      lines,
    };
  });
}

async function loadCandidateSourceDocs(
  supplierMap: Map<string, string>
): Promise<CandidateSourceDoc[]> {
  const [allPOs, allWOs] = await Promise.all([
    getRecords(TABLES.PURCHASE_ORDERS),
    getRecords(TABLES.WORK_ORDERS),
  ]);

  const poMatchable = new Set(["Issued", "Accepted", "Shipped", "Partially Received"]);
  const woMatchable = new Set(["Issued", "In Progress", "Completed"]);

  const pos: CandidateSourceDoc[] = allPOs
    .filter((po) => poMatchable.has(po.fields["Status"] as string))
    .map((po) => {
      const supplierId = (po.fields["Supplier"] as string[])?.[0] ?? null;
      return {
        type: "po" as const,
        id: po.id,
        number: (po.fields["PO Number"] as string) || "",
        date: (po.fields["Date"] as string) || "",
        supplier: supplierId ? (supplierMap.get(supplierId) ?? null) : null,
        status: (po.fields["Status"] as string) || "",
      };
    })
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  const wos: CandidateSourceDoc[] = allWOs
    .filter((wo) => woMatchable.has(wo.fields["Status"] as string))
    .map((wo) => ({
      type: "wo" as const,
      id: wo.id,
      number: (wo.fields["WO Number"] as string) || "",
      date: (wo.fields["Date"] as string) || (wo.createdTime?.slice(0, 10) ?? ""),
      supplier: null,
      status: (wo.fields["Status"] as string) || "",
    }))
    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  return [...pos, ...wos];
}

async function loadCandidateInvoices(
  supplierMap: Map<string, string>,
  skuMap: SkuMap
): Promise<CandidateInvoice[]> {
  const [allInvoices, allInvoiceLines] = await Promise.all([
    getRecords(TABLES.INVOICES),
    getRecords(TABLES.INVOICE_LINES),
  ]);

  // Build lineId → full line data map
  const lineDataMap = new Map<string, CandidateInvoiceLine>();
  for (const line of allInvoiceLines) {
    const skuId = (line.fields["SKU"] as string[])?.[0] ?? null;
    lineDataMap.set(line.id, {
      id: line.id,
      skuId,
      skuName: skuId ? (skuMap.get(skuId)?.name ?? null) : null,
      description: (line.fields["Description"] as string) || "",
      qtyBilled: (line.fields["Qty Billed"] as number) || 0,
      unitCost: (line.fields["Unit Cost"] as number) || 0,
      amount: (line.fields["Amount"] as number) || 0,
    });
  }

  return allInvoices
    .filter((inv) => (inv.fields["Status"] as string) !== "Matched")
    .map((inv) => {
      const supplierId = (inv.fields["Supplier"] as string[])?.[0] ?? null;
      const lineIds = (inv.fields["Invoice Lines"] as string[]) || [];
      const lines = lineIds
        .map((lid) => lineDataMap.get(lid))
        .filter(Boolean) as CandidateInvoiceLine[];
      const totalFromLines = lines.reduce((s, l) => s + l.amount, 0);
      const skuIds = [...new Set(lines.map((l) => l.skuId).filter(Boolean) as string[])];
      return {
        id: inv.id,
        invoiceNumber: (inv.fields["Invoice Number"] as string) || "",
        invoiceDate: (inv.fields["Date"] as string) || "",
        supplier: supplierId ? (supplierMap.get(supplierId) ?? null) : null,
        totalAmount: totalFromLines || (inv.fields["Invoice Amount"] as number) || 0,
        invoiceType: (inv.fields["Invoice Type"] as string) || "Supplier",
        status: (inv.fields["Status"] as string) || "Open",
        skuIds,
        poReference: (inv.fields["PO Reference"] as string) || null,
        lines,
      };
    })
    .sort((a, b) => (b.invoiceDate || "").localeCompare(a.invoiceDate || ""));
}

function computeCheckStrip(
  invoiceLines: MatchInvoiceLine[],
  sourceDocLines: MatchSourceDocLine[],
  selectedReceipts: MatchReceipt[]
): CheckStripRow[] {
  const invoiceBySku = new Map<string, { unitCost: number; qty: number; name: string }>();
  for (const l of invoiceLines) {
    if (!l.skuId) continue;
    const prev = invoiceBySku.get(l.skuId);
    invoiceBySku.set(l.skuId, {
      unitCost: l.unitCost,
      qty: (prev?.qty ?? 0) + l.qtyBilled,
      name: l.skuName || l.skuId,
    });
  }

  const sourceBySku = new Map<string, { unitCost: number | null; qty: number }>();
  for (const l of sourceDocLines) {
    if (!l.skuId) continue;
    const prev = sourceBySku.get(l.skuId);
    sourceBySku.set(l.skuId, {
      unitCost: l.unitCost,
      qty: (prev?.qty ?? 0) + l.qtyOrdered,
    });
  }

  const receivedBySku = new Map<string, number>();
  for (const r of selectedReceipts) {
    for (const l of r.lines) {
      if (!l.skuId) continue;
      receivedBySku.set(l.skuId, (receivedBySku.get(l.skuId) ?? 0) + l.qtyReceived);
    }
  }

  return [...invoiceBySku.entries()].map(([skuId, inv]) => {
    const src = sourceBySku.get(skuId) ?? null;
    const received = receivedBySku.get(skuId) ?? null;
    const agreedUnitCost = src?.unitCost ?? null;
    const invoiceUnitCost = inv.unitCost;
    const priceMatch =
      agreedUnitCost !== null ? Math.abs(agreedUnitCost - invoiceUnitCost) < 0.001 : null;
    const qtyMatch = received !== null ? received === inv.qty : null;

    return {
      skuId,
      skuName: inv.name,
      agreedUnitCost,
      invoiceUnitCost,
      priceMatch,
      poQty: src?.qty ?? null,
      receivedQty: received,
      invoiceQty: inv.qty,
      qtyMatch,
    };
  });
}

// ─────────────────────────────────────────────────────────────
// GET /api/match?from=invoice&id=... | from=receipt&id=...
// ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") as "invoice" | "receipt" | null;
  const id = searchParams.get("id");

  if (!from || !id || !["invoice", "receipt"].includes(from)) {
    return NextResponse.json(
      { error: "from (invoice|receipt) and id are required" },
      { status: 400 }
    );
  }

  try {
    const [allSkus, allSuppliers, allWarehouses] = await Promise.all([
      getRecords(TABLES.SKUS),
      getRecords(TABLES.SUPPLIERS),
      getRecords(TABLES.WAREHOUSES),
    ]);
    const skuMap = buildSkuMap(allSkus);
    const supplierMap = buildSupplierMap(allSuppliers);
    const warehouseMap = buildWarehouseMap(allWarehouses);

    let invoice: MatchInvoice | null = null;
    let sourceDoc: MatchSourceDoc | null = null;
    let availableReceipts: MatchReceipt[] = [];
    let linkedIds: string[] = [];
    let suggestedIds: string[] = [];

    if (from === "invoice") {
      invoice = await loadInvoice(id, skuMap, supplierMap);
      if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

      const invoiceRecord = await getRecord(TABLES.INVOICES, id);
      const poId = (invoiceRecord.fields["Purchase Order"] as string[])?.[0] ?? null;
      const woId = (invoiceRecord.fields["Work Orders"] as string[])?.[0] ?? null;

      sourceDoc = await loadSourceDoc(poId, woId, skuMap, supplierMap, warehouseMap);

      if (sourceDoc) {
        availableReceipts = await loadReceiptsForSourceDoc(
          sourceDoc.id, sourceDoc.type, skuMap, warehouseMap
        );

        // Find which receipts are already linked via Invoice Line → Receipt Line
        const invoiceLineRecords = await fetchInBatches(
          invoice.lines.map((l) => l.id),
          (lid) => getRecord(TABLES.INVOICE_LINES, lid)
        );
        const linkedRLIds = new Set(
          invoiceLineRecords
            .filter(Boolean)
            .map((l) => (l.fields["Receipt Line"] as string[])?.[0])
            .filter(Boolean) as string[]
        );
        if (linkedRLIds.size > 0) {
          const allRLs = await getRecords(TABLES.RECEIPT_LINES);
          const linked = new Set<string>();
          for (const rl of allRLs) {
            if (linkedRLIds.has(rl.id)) {
              const rid = (rl.fields["Receipt"] as string[])?.[0];
              if (rid) linked.add(rid);
            }
          }
          linkedIds = [...linked];
        }

        // Suggest receipts with SKU overlap
        const invoiceSkus = new Set(
          invoice.lines.map((l) => l.skuId).filter(Boolean) as string[]
        );
        suggestedIds = availableReceipts
          .filter((r) => r.lines.some((l) => l.skuId && invoiceSkus.has(l.skuId)))
          .map((r) => r.id);
      }

      const candidateSourceDocs = sourceDoc === null
        ? await loadCandidateSourceDocs(supplierMap)
        : [];

      const receiptsForStrip = linkedIds.length > 0
        ? availableReceipts.filter((r) => linkedIds.includes(r.id))
        : availableReceipts.filter((r) => suggestedIds.includes(r.id));

      const checkStrip = invoice
        ? computeCheckStrip(invoice.lines, sourceDoc?.lines ?? [], receiptsForStrip)
        : [];

      const payload: MatchPayload = {
        anchorType: from,
        invoice,
        sourceDoc,
        receipts: { available: availableReceipts, linkedIds, suggestedIds },
        candidateSourceDocs,
        candidateInvoices: [],
        checkStrip,
      };

      return NextResponse.json(payload);
    } else {
      // Receipt anchor
      const receiptRecord = await getRecord(TABLES.RECEIPTS, id);
      if (!receiptRecord?.id) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
      }

      const poId = (receiptRecord.fields["Purchase Order"] as string[])?.[0] ?? null;
      const woId = (receiptRecord.fields["Work Order"] as string[])?.[0] ?? null;

      sourceDoc = await loadSourceDoc(poId, woId, skuMap, supplierMap, warehouseMap);

      if (sourceDoc) {
        availableReceipts = await loadReceiptsForSourceDoc(
          sourceDoc.id, sourceDoc.type, skuMap, warehouseMap
        );
        linkedIds = [id];
        suggestedIds = [id];

        // Find invoice linked to this PO
        if (poId) {
          const allInvoices = await getRecords(TABLES.INVOICES);
          const candidate = allInvoices.find(
            (inv) =>
              (inv.fields["Purchase Order"] as string[])?.[0] === poId &&
              (inv.fields["Status"] as string) !== "Matched"
          );
          if (candidate) {
            invoice = await loadInvoice(candidate.id, skuMap, supplierMap);
          }
        }
      }

      const candidateSourceDocs = sourceDoc === null
        ? await loadCandidateSourceDocs(supplierMap)
        : [];

      const candidateInvoices = invoice === null
        ? await loadCandidateInvoices(supplierMap, skuMap)
        : [];

      const receiptsForStrip = linkedIds.length > 0
        ? availableReceipts.filter((r) => linkedIds.includes(r.id))
        : availableReceipts.filter((r) => suggestedIds.includes(r.id));

      const checkStrip = invoice
        ? computeCheckStrip(invoice.lines, sourceDoc?.lines ?? [], receiptsForStrip)
        : [];

      const payload: MatchPayload = {
        anchorType: from,
        invoice,
        sourceDoc,
        receipts: { available: availableReceipts, linkedIds, suggestedIds },
        candidateSourceDocs,
        candidateInvoices,
        checkStrip,
      };

      return NextResponse.json(payload);
    }
  } catch (error) {
    console.error("Match GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// PATCH /api/match — confirm the match and write all links
// ─────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const authError = await requireOperator();
  if (authError) return authError;

  try {
    const body = await request.json();

    // Handle unlink_source action
    if (body.action === "unlink_source") {
      const { from, id } = body as { action: string; from: string; id: string };
      if (from === "invoice") {
        const record = await getRecord(TABLES.INVOICES, id);
        const poLink = (record.fields["Purchase Order"] as string[])?.[0];
        const woLink = (record.fields["Work Orders"] as string[])?.[0];
        if (poLink) await updateRecord(TABLES.INVOICES, id, { "Purchase Order": [] });
        if (woLink) await updateRecord(TABLES.INVOICES, id, { "Work Orders": [] });
      }
      return NextResponse.json({ ok: true });
    }

    const { from, id, sourceDocId, sourceDocType, selectedReceiptIds, selectedInvoiceId } = body as {
      from: "invoice" | "receipt";
      id: string;
      sourceDocId: string;
      sourceDocType: "po" | "wo";
      selectedReceiptIds: string[];
      selectedInvoiceId?: string;
    };

    if (!id || !sourceDocId || !selectedReceiptIds?.length) {
      return NextResponse.json(
        { error: "id, sourceDocId, and selectedReceiptIds are required" },
        { status: 400 }
      );
    }

    const invoiceId = from === "invoice" ? id : (selectedInvoiceId ?? null);

    const [allSkus, allReceiptLines, allPOLineItems, allWOLineItems] = await Promise.all([
      getRecords(TABLES.SKUS),
      getRecords(TABLES.RECEIPT_LINES),
      sourceDocType === "po" ? getRecords(TABLES.PO_LINE_ITEMS) : Promise.resolve([]),
      sourceDocType === "wo" ? getRecords(TABLES.WORK_ORDER_LINES) : Promise.resolve([]),
    ]);
    const skuMap = buildSkuMap(allSkus);

    // Load invoice lines
    let invoiceLineRecords: Awaited<ReturnType<typeof getRecord>>[] = [];
    if (invoiceId) {
      const invoiceRecord = await getRecord(TABLES.INVOICES, invoiceId);
      const lineIds = (invoiceRecord.fields["Invoice Lines"] as string[]) || [];
      invoiceLineRecords = await fetchInBatches(lineIds, (lid) =>
        getRecord(TABLES.INVOICE_LINES, lid)
      );
    }

    // PO line items for this PO
    const poLineItems = allPOLineItems.filter(
      (li) => (li.fields["Purchase Order"] as string[])?.[0] === sourceDocId
    );

    // SKU → first available PO line item ID
    const poLineBySku = new Map<string, string>();
    for (const li of poLineItems) {
      const skuId = (li.fields["SKU"] as string[])?.[0];
      if (skuId && !poLineBySku.has(skuId)) poLineBySku.set(skuId, li.id);
    }

    // WO output line items for this WO (only Output type)
    const woLineItems = allWOLineItems.filter(
      (li) =>
        (li.fields["Work Order"] as string[])?.[0] === sourceDocId &&
        (li.fields["Line Type"] as string) === "Output"
    );

    // SKU → first available WO output line item ID
    const woLineBySku = new Map<string, string>();
    for (const li of woLineItems) {
      const skuId = (li.fields["SKU"] as string[])?.[0];
      if (skuId && !woLineBySku.has(skuId)) woLineBySku.set(skuId, li.id);
    }

    // SKU → invoice line ID (mutable — consumed as we match)
    const invoiceLineBySku = new Map<string, string>();
    for (const il of invoiceLineRecords) {
      if (!il) continue;
      const skuId = (il.fields["SKU"] as string[])?.[0];
      if (skuId && !invoiceLineBySku.has(skuId)) invoiceLineBySku.set(skuId, il.id);
    }

    const updates: Promise<unknown>[] = [];

    // Link invoice → source doc
    if (invoiceId) {
      updates.push(
        updateRecord(TABLES.INVOICES, invoiceId, {
          [sourceDocType === "po" ? "Purchase Order" : "Work Orders"]: [sourceDocId],
        })
      );
    }

    // Link receipts → source doc (header)
    const selectedSet = new Set(selectedReceiptIds);
    for (const receiptId of selectedReceiptIds) {
      updates.push(
        updateRecord(TABLES.RECEIPTS, receiptId, {
          [sourceDocType === "po" ? "Purchase Order" : "Work Order"]: [sourceDocId],
        })
      );
    }

    // Link receipt lines → PO line items + invoice lines
    const selectedLines = allReceiptLines.filter((rl) =>
      selectedSet.has((rl.fields["Receipt"] as string[])?.[0] ?? "")
    );

    for (const rl of selectedLines) {
      const skuId = (rl.fields["SKU"] as string[])?.[0];
      if (!skuId) continue;

      const poLineItemId = sourceDocType === "po" ? poLineBySku.get(skuId) : undefined;
      const woLineItemId = sourceDocType === "wo" ? woLineBySku.get(skuId) : undefined;
      const invoiceLineId = invoiceLineBySku.get(skuId);

      const rlFields: Record<string, unknown> = { "Source Match": "Linked" };
      if (poLineItemId) rlFields["PO Line Item"] = [poLineItemId];
      if (woLineItemId) rlFields["Work Order Lines"] = [woLineItemId];
      if (invoiceLineId) rlFields["Invoice Match"] = "Linked";

      updates.push(updateRecord(TABLES.RECEIPT_LINES, rl.id, rlFields));

      if (invoiceLineId) {
        updates.push(
          updateRecord(TABLES.INVOICE_LINES, invoiceLineId, {
            "Receipt Line": [rl.id],
            "Receipt Match": "Linked",
          })
        );
        invoiceLineBySku.delete(skuId); // consume so we don't double-link
      }
    }

    await Promise.all(updates);

    // Update invoice status
    if (invoiceId) {
      await updateRecord(TABLES.INVOICES, invoiceId, { "Status": "Matched" });
    }

    // Recalculate PO status
    if (sourceDocType === "po") {
      await recalcPOStatus(sourceDocId, allReceiptLines, skuMap, allPOLineItems);
    }

    logActivity({
      poId: sourceDocType === "po" ? sourceDocId : undefined,
      woId: sourceDocType === "wo" ? sourceDocId : undefined,
      action: "invoice_matched",
      description: `Match confirmed — ${selectedReceiptIds.length} receipt(s)`,
      actor: "Ryan Belanger",
      relatedRecordType: "invoice",
      relatedRecordId: invoiceId ?? id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Match PATCH error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// ─────────────────────────────────────────────────────────────
// PO status recalculation
// ─────────────────────────────────────────────────────────────

async function recalcPOStatus(
  poId: string,
  allReceiptLines: Awaited<ReturnType<typeof getRecords>>,
  skuMap: SkuMap,
  allPOLineItems: Awaited<ReturnType<typeof getRecords>>
) {
  const po = await getRecord(TABLES.PURCHASE_ORDERS, poId);
  if (!po) return;

  const poLines = allPOLineItems.filter(
    (li) => (li.fields["Purchase Order"] as string[])?.[0] === poId
  );

  const allReceipts = await getRecords(TABLES.RECEIPTS);
  const poReceiptIds = new Set(
    allReceipts
      .filter((r) => (r.fields["Purchase Order"] as string[])?.[0] === poId)
      .map((r) => r.id)
  );

  const receivedBySku = new Map<string, number>();
  for (const rl of allReceiptLines) {
    if (!poReceiptIds.has((rl.fields["Receipt"] as string[])?.[0] ?? "")) continue;
    const skuId = (rl.fields["SKU"] as string[])?.[0];
    if (skuId) {
      receivedBySku.set(
        skuId,
        (receivedBySku.get(skuId) ?? 0) + ((rl.fields["Qty Received"] as number) || 0)
      );
    }
  }

  let allReceived = true;
  let anyReceived = false;
  for (const li of poLines) {
    const skuId = (li.fields["SKU"] as string[])?.[0];
    if (!skuId) continue;
    const uom = skuMap.get(skuId)?.uom ?? "Each";
    const ordered =
      uom === "Carton"
        ? (li.fields["Qty Cartons"] as number) || 0
        : (li.fields["Qty Sticks"] as number) || (li.fields["Qty Cartons"] as number) || 0;
    const received = receivedBySku.get(skuId) ?? 0;
    if (received > 0) anyReceived = true;
    if (received < ordered) allReceived = false;
  }

  const current = po.fields["Status"] as string;
  let next: string | null = null;
  if (allReceived && anyReceived && poLines.length > 0) next = "Received";
  else if (anyReceived) next = "Partially Received";

  const validTransitions: Record<string, string[]> = {
    Issued: ["Partially Received", "Received"],
    Accepted: ["Partially Received", "Received"],
    Shipped: ["Partially Received", "Received"],
    "Partially Received": ["Received"],
  };

  if (next && validTransitions[current]?.includes(next)) {
    await updateRecord(TABLES.PURCHASE_ORDERS, poId, { Status: next });
  }
}
