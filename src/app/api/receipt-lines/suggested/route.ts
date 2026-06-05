import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";

function normalize(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

/**
 * GET /api/receipt-lines/suggested
 *
 * Returns all receipt lines from silver, deduplicated by (item_id, received_date,
 * source_doc_no). Lines with identical SKU + date + order reference are merged into
 * one group and their quantities summed. Each group includes an AI invoice suggestion
 * for unmatched groups.
 */
export async function GET() {
  try {
    // ── 1. Silver lines + statuses ──────────────────────────────────────────────

    const [silverRes, statusRes] = await Promise.all([
      db.schema("orchard_calcs").from("receipt_lines")
        .select("id, source, source_doc_no, received_date, warehouse_code, item_id, three_pl_sku, po_id, qty_received"),
      db.schema("orchard_calcs").from("receipt_line_statuses")
        .select("receipt_line_id, invoice_status, flag"),
    ]);

    if (silverRes.error) throw silverRes.error;
    const silverLines = silverRes.data ?? [];
    const statusByLineId = new Map((statusRes.data ?? []).map(s => [s.receipt_line_id as string, s]));

    // ── 2. Resolve SKUs ─────────────────────────────────────────────────────────

    const itemIds = [...new Set(silverLines.map(l => l.item_id as string).filter(Boolean))];
    const { data: items } = itemIds.length
      ? await db.schema("org_config").from("items").select("id, sku").in("id", itemIds)
      : { data: [] };
    const skuMap = new Map((items ?? []).map(i => [i.id as string, i.sku as string]));

    // ── 3. Invoice links for matched lines ──────────────────────────────────────

    const { data: invLinks } = await db.schema("orchard_calcs")
      .from("receipt_line_invoice_line_links")
      .select("receipt_line_id, invoice_line_id");
    const invLinkByLineId = new Map<string, string>();
    for (const l of invLinks ?? []) {
      if (!invLinkByLineId.has(l.receipt_line_id as string)) {
        invLinkByLineId.set(l.receipt_line_id as string, l.invoice_line_id as string);
      }
    }

    // Load invoice data for matched lines
    const linkedInvLineIds = [...new Set((invLinks ?? []).map(l => l.invoice_line_id as string))];
    type InvLineRow = { id: string; invoice_id: string; unit_price: number; qty: number };
    type InvRow = { id: string; invoice_number: string; freight: number | null; tax: number | null };

    let invLineMap = new Map<string, InvLineRow>();
    let invoiceMap = new Map<string, InvRow>();
    let invoiceLineQtys = new Map<string, number>();

    if (linkedInvLineIds.length > 0) {
      const { data: invLines } = await db.schema("orchard").from("invoice_lines")
        .select("id, invoice_id, unit_price, qty").in("id", linkedInvLineIds);
      invLineMap = new Map((invLines ?? []).map(l => [l.id as string, l as InvLineRow]));

      const linkedInvIds = [...new Set((invLines ?? []).map(l => (l as InvLineRow).invoice_id))];
      const [{ data: invoices }, { data: allInvLines }] = await Promise.all([
        db.schema("orchard").from("invoices").select("id, invoice_number, freight, tax").in("id", linkedInvIds),
        db.schema("orchard").from("invoice_lines").select("invoice_id, item_id, qty").in("invoice_id", linkedInvIds),
      ]);
      invoiceMap = new Map((invoices ?? []).map(i => [i.id as string, i as InvRow]));
      for (const l of allInvLines ?? []) {
        if (!l.item_id) continue;
        invoiceLineQtys.set(l.invoice_id as string, (invoiceLineQtys.get(l.invoice_id as string) ?? 0) + (Number(l.qty) || 0));
      }
    }

    // ── 4. Deduplicate into groups ───────────────────────────────────────────────

    type LineGroup = {
      groupKey: string;
      itemId: string | null;
      sku: string | null;
      threePlSku: string | null;
      date: string | null;
      warehouse: string | null;
      source: string;
      orderRef: string | null;
      poId: string | null;
      totalQty: number;
      lineIds: string[];
      invoiceStatus: "unmatched" | "matched" | "excluded";
    };

    const groups = new Map<string, LineGroup>();

    for (const line of silverLines) {
      const itemId = (line.item_id as string) ?? null;
      const date = (line.received_date as string) ?? null;
      const docNo = (line.source_doc_no as string) ?? null;
      const key = `${itemId ?? ""}|${date ?? ""}|${docNo ?? ""}`;

      const s = statusByLineId.get(line.id as string);
      const lineStatus: LineGroup["invoiceStatus"] =
        s?.flag === "excluded" ? "excluded"
        : s?.invoice_status === "matched" ? "matched"
        : "unmatched";

      if (!groups.has(key)) {
        groups.set(key, {
          groupKey: key,
          itemId,
          sku: itemId ? (skuMap.get(itemId) ?? null) : null,
          threePlSku: (line.three_pl_sku as string) ?? null,
          date,
          warehouse: (line.warehouse_code as string) ?? null,
          source: (line.source as string) ?? "unknown",
          orderRef: docNo,
          poId: (line.po_id as string) ?? null,
          totalQty: 0,
          lineIds: [],
          invoiceStatus: lineStatus,
        });
      }

      const group = groups.get(key)!;
      group.totalQty += Number(line.qty_received) || 0;
      group.lineIds.push(line.id as string);
      // Any unmatched line makes the group unmatched
      if (lineStatus === "unmatched") group.invoiceStatus = "unmatched";
      else if (lineStatus === "matched" && group.invoiceStatus !== "unmatched") group.invoiceStatus = "matched";
    }

    // ── 5. Linked invoice for matched groups ─────────────────────────────────────

    type LinkedInvoiceInfo = {
      invoiceId: string;
      invoiceLineId: string;
      invoiceNumber: string;
      unitCost: number;
      overheadPerUnit: number;
      landedUnitCost: number;
    };

    const linkedInvoiceByGroup = new Map<string, LinkedInvoiceInfo>();

    for (const group of groups.values()) {
      if (group.invoiceStatus !== "matched") continue;
      const matchedLineId = group.lineIds.find(id => invLinkByLineId.has(id));
      if (!matchedLineId) continue;
      const invLineId = invLinkByLineId.get(matchedLineId)!;
      const invLine = invLineMap.get(invLineId);
      if (!invLine) continue;
      const inv = invoiceMap.get(invLine.invoice_id);
      if (!inv) continue;
      const freight = Number(inv.freight) || 0;
      const tax = Number(inv.tax) || 0;
      const totalQty = invoiceLineQtys.get(inv.id) ?? 0;
      const overhead = totalQty > 0 ? (freight + tax) / totalQty : 0;
      const unitCost = Number(invLine.unit_price) || 0;
      linkedInvoiceByGroup.set(group.groupKey, {
        invoiceId: inv.id as string,
        invoiceNumber: inv.invoice_number as string,
        invoiceLineId: invLineId,
        unitCost,
        overheadPerUnit: round4(overhead),
        landedUnitCost: round4(unitCost + overhead),
      });
    }

    // ── 6. AI suggestions for unmatched groups ───────────────────────────────────

    type SuggestionInfo = {
      invoiceId: string;
      invoiceLineId: string;
      invoiceNumber: string;
      unitCost: number;
      overheadPerUnit: number;
      landedUnitCost: number;
      confidence: "high" | "medium" | "low";
    };

    const suggestionByGroup = new Map<string, SuggestionInfo>();
    const unmatchedGroups = [...groups.values()].filter(g => g.invoiceStatus === "unmatched");

    if (unmatchedGroups.length > 0) {
      const unmatchedItemIds = [...new Set(unmatchedGroups.map(g => g.itemId).filter(Boolean) as string[])];

      if (unmatchedItemIds.length > 0) {
        type CandInvLine = { id: string; invoice_id: string; item_id: string | null; unit_price: number; qty: number };
        type CandInv = {
          id: string; invoice_number: string; supplier_id: string | null;
          po_reference: string | null; invoice_date: string | null;
          freight: number | null; tax: number | null;
        };

        const { data: candLines } = await db.schema("orchard").from("invoice_lines")
          .select("id, invoice_id, item_id, unit_price, qty").in("item_id", unmatchedItemIds);

        const candInvoiceIds = [...new Set((candLines ?? []).map(l => (l as CandInvLine).invoice_id))];

        if (candInvoiceIds.length > 0) {
          const [{ data: candInvoices }, { data: candStatuses }, { data: candAllLines }] = await Promise.all([
            db.schema("orchard").from("invoices")
              .select("id, invoice_number, supplier_id, po_reference, invoice_date, freight, tax")
              .in("id", candInvoiceIds),
            db.schema("orchard_calcs").from("invoice_statuses")
              .select("invoice_id, match_status").in("invoice_id", candInvoiceIds),
            db.schema("orchard").from("invoice_lines")
              .select("invoice_id, item_id, qty").in("invoice_id", candInvoiceIds),
          ]);

          const fullyMatchedIds = new Set(
            (candStatuses ?? []).filter(s => s.match_status === "matched").map(s => s.invoice_id as string)
          );
          const availableInvoices = new Map<string, CandInv>(
            (candInvoices ?? [])
              .filter(inv => !fullyMatchedIds.has(inv.id as string))
              .map(inv => [inv.id as string, inv as CandInv])
          );

          const candInvLineQtys = new Map<string, number>();
          for (const l of candAllLines ?? []) {
            if (!l.item_id) continue;
            candInvLineQtys.set(l.invoice_id as string, (candInvLineQtys.get(l.invoice_id as string) ?? 0) + (Number(l.qty) || 0));
          }

          // PO lookup for supplier + number matching
          const poIds = [...new Set(unmatchedGroups.map(g => g.poId).filter(Boolean) as string[])];
          const { data: poRows } = poIds.length
            ? await db.schema("orchard").from("purchase_orders").select("id, po_number, supplier_id").in("id", poIds)
            : { data: [] };
          const poMap = new Map((poRows ?? []).map(p => [p.id as string, p]));

          for (const group of unmatchedGroups) {
            if (!group.itemId) continue;

            const po = group.poId ? poMap.get(group.poId) : null;
            const poNumber = (po?.po_number as string) ?? "";
            const supplierId = (po?.supplier_id as string) ?? "";
            const docNo = group.orderRef ?? "";

            const itemCandLines = (candLines ?? []).filter(
              cl => (cl as CandInvLine).item_id === group.itemId && availableInvoices.has((cl as CandInvLine).invoice_id)
            ) as CandInvLine[];

            if (itemCandLines.length === 0) continue;

            const scored = itemCandLines.map(cl => {
              const inv = availableInvoices.get(cl.invoice_id);
              if (!inv) return null;
              const normRef = inv.po_reference ? normalize(inv.po_reference) : "";
              const normPo = poNumber ? normalize(poNumber) : "";
              const normDoc = docNo ? normalize(docNo) : "";
              // Match if invoice po_reference contains the PO number OR the source_doc_no
              const poRefMatch = normRef !== "" && (
                (normPo !== "" && (normRef.includes(normPo) || normPo.includes(normRef))) ||
                (normDoc !== "" && (normRef.includes(normDoc) || normDoc.includes(normRef)))
              );
              const supplierMatch = supplierId !== "" && inv.supplier_id === supplierId;
              return {
                invoiceLineId: cl.id,
                invoiceId: cl.invoice_id,
                invoiceNumber: inv.invoice_number as string,
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

            const invQty = candInvLineQtys.get(top.invoiceId) ?? 0;
            const overhead = invQty > 0 ? (top.freight + top.tax) / invQty : 0;

            suggestionByGroup.set(group.groupKey, {
              invoiceId: top.invoiceId,
              invoiceLineId: top.invoiceLineId,
              invoiceNumber: top.invoiceNumber,
              unitCost: top.unitCost,
              overheadPerUnit: round4(overhead),
              landedUnitCost: round4(top.unitCost + overhead),
              confidence: top.poRefMatch ? "high" : top.supplierMatch ? "medium" : "low",
            });
          }
        }
      }
    }

    // ── 7. Assemble response ─────────────────────────────────────────────────────

    const result = [...groups.values()].map(group => ({
      groupKey: group.groupKey,
      lineIds: group.lineIds,
      sku: group.sku,
      itemId: group.itemId,
      threePlSku: group.threePlSku !== group.sku ? (group.threePlSku ?? null) : null,
      date: group.date,
      warehouse: group.warehouse,
      source: group.source,
      orderRef: group.orderRef,
      totalQty: group.totalQty,
      invoiceStatus: group.invoiceStatus,
      linkedInvoice: linkedInvoiceByGroup.get(group.groupKey) ?? null,
      suggestedInvoice: group.invoiceStatus === "unmatched"
        ? (suggestionByGroup.get(group.groupKey) ?? null)
        : null,
    }));

    result.sort((a, b) => {
      const order = { unmatched: 0, matched: 1, excluded: 2 };
      if (order[a.invoiceStatus] !== order[b.invoiceStatus]) {
        return order[a.invoiceStatus] - order[b.invoiceStatus];
      }
      return (b.date ?? "").localeCompare(a.date ?? "");
    });

    const counts = {
      unmatched: result.filter(r => r.invoiceStatus === "unmatched").length,
      matched: result.filter(r => r.invoiceStatus === "matched").length,
      excluded: result.filter(r => r.invoiceStatus === "excluded").length,
    };

    return NextResponse.json({ lines: result, counts });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch suggested lines: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}
