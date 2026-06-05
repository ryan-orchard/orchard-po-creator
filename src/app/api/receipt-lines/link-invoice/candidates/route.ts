import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

/**
 * GET /api/receipt-lines/link-invoice/candidates
 *
 * Given selected receipt line IDs, returns candidate invoices to link to.
 *
 * Filtering: invoices that have at least one line whose item_id matches a
 * selected receipt line's item_id, and aren't already fully Matched.
 *
 * Ranking:
 *   1. PO-reference text on invoice contains the receipt's PO number / order ref
 *   2. Supplier matches the receipts' linked PO supplier (when known)
 *   3. SKU overlap count (descending)
 *   4. Invoice date (descending)
 *
 * For each candidate invoice, returns ALL of its lines so the modal can
 * display every line and let the user pick which to match.
 *
 * Query params: receiptLineIds=id1,id2,...
 */
export async function GET(request: NextRequest) {
  try {
    const idsParam = request.nextUrl.searchParams.get("receiptLineIds") || "";
    const receiptLineIds = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (receiptLineIds.length === 0) {
      return NextResponse.json(
        { error: "receiptLineIds query param is required" },
        { status: 400 }
      );
    }

    // 1. Selected receipt lines — read from Silver (unified source for Stord + BMC)
    const { data: receiptLines, error: rlErr } = await db
      .schema("orchard_calcs")
      .from("receipt_lines")
      .select("id, item_id, qty_received, po_id, source_doc_no")
      .in("id", receiptLineIds);
    if (rlErr) throw rlErr;

    if (!receiptLines || receiptLines.length === 0) {
      return NextResponse.json({
        candidates: [],
        selectedItems: [],
        selectedRefs: [],
        message: "No receipt lines found.",
      });
    }

    const itemIds = [
      ...new Set(
        receiptLines.map((rl) => rl.item_id as string).filter(Boolean)
      ),
    ];

    if (itemIds.length === 0) {
      return NextResponse.json({
        candidates: [],
        selectedItems: [],
        selectedRefs: [],
        message:
          "Selected receipts have no SKUs assigned. Resolve SKUs before matching.",
      });
    }

    // 2. Pull po_ids + reference strings directly from Silver lines
    const poIds = [
      ...new Set(
        receiptLines.map((rl) => rl.po_id as string).filter(Boolean)
      ),
    ];
    // source_doc_no = Stord Order Number / BMC document_no.
    // Used as a candidate reference to match against invoice.po_reference.
    const externalIds = [
      ...new Set(
        receiptLines.map((rl) => rl.source_doc_no as string).filter(Boolean)
      ),
    ];

    // 3. POs → po_numbers + supplier_ids (for ranking, not filtering)
    const posResult = poIds.length
      ? await db
          .schema("orchard")
          .from("purchase_orders")
          .select("id, po_number, supplier_id")
          .in("id", poIds)
      : { data: [] };
    const pos = posResult.data ?? [];

    const linkedSupplierIds = [
      ...new Set(pos.map((p) => p.supplier_id as string).filter(Boolean)),
    ];
    const linkedPoNumbers = [
      ...new Set(pos.map((p) => p.po_number as string).filter(Boolean)),
    ];
    const selectedRefs = [...new Set([...linkedPoNumbers, ...externalIds])];

    // 4. Item lookup (always — for display)
    const { data: items } = await db
      .schema("org_config")
      .from("items")
      .select("id, sku")
      .in("id", itemIds);
    const itemMap = new Map(
      (items ?? []).map((i) => [i.id as string, i.sku as string])
    );
    const selectedItems = itemIds.map((id) => ({
      itemId: id,
      sku: itemMap.get(id) ?? id,
    }));

    // 5. Find candidate invoice IDs: any invoice whose lines share an item_id
    const { data: matchingLines } = await db
      .schema("orchard")
      .from("invoice_lines")
      .select("invoice_id")
      .in("item_id", itemIds);

    const candidateInvoiceIds = [
      ...new Set((matchingLines ?? []).map((l) => l.invoice_id as string)),
    ];

    if (candidateInvoiceIds.length === 0) {
      return NextResponse.json({
        candidates: [],
        selectedItems,
        selectedRefs,
      });
    }

    // 6. Load those invoices and their authoritative match statuses
    const [{ data: invoices }, { data: invoiceStatusRows }] = await Promise.all([
      db
        .schema("orchard")
        .from("invoices")
        .select("id, invoice_number, invoice_date, supplier_id, po_reference, total_amount, invoice_type, ship_to_text")
        .in("id", candidateInvoiceIds),
      db
        .schema("orchard_calcs")
        .from("invoice_statuses")
        .select("invoice_id, match_status")
        .in("invoice_id", candidateInvoiceIds),
    ]);
    const invoiceMatchStatusMap = new Map(
      (invoiceStatusRows ?? []).map((s) => [s.invoice_id as string, s.match_status as string])
    );
    const unmatchedInvoices = (invoices ?? []).filter(
      (inv) => (invoiceMatchStatusMap.get(inv.id as string) ?? "Unmatched") !== "Matched"
    );

    if (!unmatchedInvoices || unmatchedInvoices.length === 0) {
      return NextResponse.json({
        candidates: [],
        selectedItems,
        selectedRefs,
      });
    }
    // Alias for the rest of the function
    const invoices_ = unmatchedInvoices;

    // 7. Load all lines for those invoices
    const invoiceIds = invoices_.map((i) => i.id as string);
    const { data: allInvoiceLines } = await db
      .schema("orchard")
      .from("invoice_lines")
      .select(
        "id, invoice_id, item_id, qty, unit_price, total, description, ans_item_number"
      )
      .in("invoice_id", invoiceIds);

    // 8. Resolve SKUs for all invoice line items (may include items beyond the selected set)
    const allLineItemIds = [
      ...new Set(
        (allInvoiceLines ?? [])
          .map((l) => l.item_id as string)
          .filter(Boolean)
      ),
    ];
    const extraItemIds = allLineItemIds.filter((id) => !itemMap.has(id));
    if (extraItemIds.length > 0) {
      const { data: extraItems } = await db
        .schema("org_config")
        .from("items")
        .select("id, sku")
        .in("id", extraItemIds);
      for (const it of extraItems ?? []) {
        itemMap.set(it.id as string, it.sku as string);
      }
    }

    // 9. Supplier lookup for display
    const allSupplierIds = [
      ...new Set(
        invoices_.map((i) => i.supplier_id as string).filter(Boolean)
      ),
    ];
    const { data: suppliers } = allSupplierIds.length
      ? await db
          .schema("org_config")
          .from("suppliers")
          .select("id, name")
          .in("id", allSupplierIds)
      : { data: [] };
    const supplierMap = new Map(
      (suppliers ?? []).map((s) => [s.id as string, s.name as string])
    );

    // 10. Group lines by invoice
    const linesByInvoice = new Map<string, typeof allInvoiceLines>();
    for (const line of allInvoiceLines ?? []) {
      const invId = line.invoice_id as string;
      if (!linesByInvoice.has(invId)) linesByInvoice.set(invId, []);
      linesByInvoice.get(invId)!.push(line);
    }

    // 11. Build candidates
    const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const normalizedRefs = selectedRefs.map(normalize).filter(Boolean);
    const selectedItemIdSet = new Set(itemIds);

    const candidates = invoices_.map((inv) => {
      const lines = (linesByInvoice.get(inv.id as string) ?? []).map((l) => {
        const itemId = (l.item_id as string) ?? null;
        return {
          invoiceLineId: l.id as string,
          itemId,
          sku: itemId ? itemMap.get(itemId) ?? null : null,
          ansItemNumber: (l.ans_item_number as string) ?? "",
          description: (l.description as string) ?? "",
          qty: Number(l.qty) || 0,
          unitPrice: Number(l.unit_price) || 0,
          total: Number(l.total) || 0,
          isOverlap: itemId ? selectedItemIdSet.has(itemId) : false,
        };
      });

      const overlapItemIds = new Set(
        lines.filter((l) => l.isOverlap).map((l) => l.itemId!)
      );
      const normalizedInvRef = inv.po_reference
        ? normalize(inv.po_reference as string)
        : "";
      const poRefMatches =
        normalizedInvRef !== "" &&
        normalizedRefs.some(
          (r) => normalizedInvRef.includes(r) || r.includes(normalizedInvRef)
        );
      const supplierMatches =
        !!inv.supplier_id &&
        linkedSupplierIds.includes(inv.supplier_id as string);

      return {
        invoiceId: inv.id as string,
        invoiceNumber: inv.invoice_number as string,
        supplier:
          (inv.supplier_id && supplierMap.get(inv.supplier_id as string)) ??
          "",
        invoiceDate: (inv.invoice_date as string) ?? "",
        total: Number(inv.total_amount) || 0,
        poReference: (inv.po_reference as string) ?? "",
        shipTo: (inv.ship_to_text as string) ?? "",
        invoiceType: (inv.invoice_type as string) ?? "Supplier",
        matchStatus: invoiceMatchStatusMap.get(inv.id as string) ?? "Unmatched",
        skuOverlap: overlapItemIds.size,
        poRefMatches,
        supplierMatches,
        lines,
      };
    });

    // 12. Sort: PO Ref match → supplier match → overlap count → date desc
    candidates.sort((a, b) => {
      if (a.poRefMatches !== b.poRefMatches) return a.poRefMatches ? -1 : 1;
      if (a.supplierMatches !== b.supplierMatches)
        return a.supplierMatches ? -1 : 1;
      if (a.skuOverlap !== b.skuOverlap) return b.skuOverlap - a.skuOverlap;
      return (b.invoiceDate || "").localeCompare(a.invoiceDate || "");
    });

    return NextResponse.json({
      candidates,
      selectedItems,
      selectedRefs,
    });
  } catch (error) {
    console.error("Link invoice candidates error:", error);
    return NextResponse.json(
      {
        error: `Failed to fetch candidates: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      { status: 500 }
    );
  }
}
