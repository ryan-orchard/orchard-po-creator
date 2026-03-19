import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";
import { attemptPOMatch } from "@/lib/po-matching";

/**
 * GET /api/invoices/matching
 *
 * Returns all invoices with comparison data for inline matching UI.
 *
 * For each invoice:
 * - Finds the PO via PO Reference
 * - Finds receipts matched to that PO
 * - Scores receipt candidates by SKU+qty overlap with invoice lines
 * - Builds comparison: invoice qty vs receipt qty, invoice price vs PO price
 *
 * Matching is at the LINE level: Invoice Line → Receipt Line.
 * Invoice-level Match Status (Open/Matched/Discrepancy) is derived from line state.
 */
export async function GET() {
  try {
    // 1. Fetch all data in parallel
    const [
      allInvoices,
      allInvoiceLines,
      allPOs,
      allPOLineItems,
      allReceipts,
      allReceiptLines,
      allItems,
      allSuppliers,
    ] = await Promise.all([
      getRecords(TABLES.INVOICES, {
        sort: [{ field: "Invoice Date", direction: "desc" }],
      }),
      getRecords(TABLES.INVOICE_LINES),
      getRecords(TABLES.PURCHASE_ORDERS, {
        sort: [{ field: "PO Number", direction: "desc" }],
      }),
      getRecords(TABLES.PO_LINE_ITEMS),
      getRecords(TABLES.RECEIPTS),
      getRecords(TABLES.RECEIPT_LINES),
      getRecords(TABLES.SKUS),
      getRecords(TABLES.SUPPLIERS),
    ]);

    // 2. Build lookup maps

    // Items
    const itemMap: Record<
      string,
      { name: string; uom: string; sticksPerCarton: number | null }
    > = {};
    for (const item of allItems) {
      itemMap[item.id] = {
        name:
          (item.fields["Standard SKU"] as string) ||
          (item.fields["Name"] as string) ||
          item.id,
        uom: (item.fields["UOM"] as string) || "Each",
        sticksPerCarton: (item.fields["Sticks per Carton"] as number) || null,
      };
    }

    // Suppliers
    const supplierMap: Record<string, string> = {};
    for (const s of allSuppliers) {
      supplierMap[s.id] = (s.fields["Supplier Name"] as string) || "";
    }

    // POs
    const poMap: Record<
      string,
      { poNumber: string; status: string; date: string }
    > = {};
    const poCandidates: { id: string; poNumber: string }[] = [];
    for (const po of allPOs) {
      const poNumber = (po.fields["PO Number"] as string) || "";
      const status = (po.fields["Status"] as string) || "";
      poMap[po.id] = {
        poNumber,
        status,
        date: (po.fields["Date"] as string) || "",
      };
      if (
        status === "Issued" ||
        status === "Partially Received" ||
        status === "Received"
      ) {
        poCandidates.push({ id: po.id, poNumber });
      }
    }

    // PO Line Items grouped by PO
    const poLinesByPO: Record<
      string,
      {
        id: string;
        skuId: string;
        qtyOrdered: number;
        unitCost: number;
      }[]
    > = {};
    for (const li of allPOLineItems) {
      const poLinks = li.fields["Purchase Order"] as string[] | undefined;
      const skuLinks = li.fields["SKU"] as string[] | undefined;
      if (!poLinks?.[0] || !skuLinks?.[0]) continue;
      const poId = poLinks[0];
      const skuId = skuLinks[0];
      const item = itemMap[skuId];
      const uom = item?.uom || "Each";
      const qtyOrdered =
        uom === "Carton"
          ? (li.fields["Qty Cartons"] as number) || 0
          : (li.fields["Qty Sticks"] as number) ||
            (li.fields["Qty Cartons"] as number) ||
            0;

      if (!poLinesByPO[poId]) poLinesByPO[poId] = [];
      poLinesByPO[poId].push({
        id: li.id,
        skuId,
        qtyOrdered,
        unitCost: (li.fields["Unit Cost"] as number) || 0,
      });
    }

    // Receipts grouped by PO
    const receiptsByPO: Record<string, string[]> = {};
    const receiptMap: Record<
      string,
      {
        receiptNumber: string;
        receivedDate: string;
        poId: string | null;
      }
    > = {};
    for (const r of allReceipts) {
      const poIds = r.fields["Purchase Order"] as string[] | undefined;
      const poId = poIds?.[0] || null;
      receiptMap[r.id] = {
        receiptNumber: (r.fields["Receipt Number"] as string) || "",
        receivedDate: (r.fields["Received Date"] as string) || "",
        poId,
      };
      if (poId) {
        if (!receiptsByPO[poId]) receiptsByPO[poId] = [];
        receiptsByPO[poId].push(r.id);
      }
    }

    // Receipt Lines grouped by receipt (with record IDs for line-level linking)
    const receiptLinesByReceipt: Record<
      string,
      { id: string; skuId: string; qtyReceived: number }[]
    > = {};
    for (const rl of allReceiptLines) {
      const receiptIds = rl.fields["Receipt"] as string[] | undefined;
      const skuIds = rl.fields["SKU"] as string[] | undefined;
      if (!receiptIds?.[0] || !skuIds?.[0]) continue;
      const receiptId = receiptIds[0];
      if (!receiptLinesByReceipt[receiptId])
        receiptLinesByReceipt[receiptId] = [];
      receiptLinesByReceipt[receiptId].push({
        id: rl.id,
        skuId: skuIds[0],
        qtyReceived: (rl.fields["Qty Received"] as number) || 0,
      });
    }

    // Invoice Lines grouped by invoice (with Receipt Line link for tracking matched state)
    const invoiceLinesByInvoice: Record<
      string,
      {
        id: string;
        skuId: string | null;
        skuName: string | null;
        ansItemNumber: string | null;
        qtyBilled: number;
        unitCost: number;
        amount: number;
        receiptLineId: string | null;
      }[]
    > = {};
    // Track which receipt lines are already claimed by invoice lines
    const claimedReceiptLines = new Set<string>();

    for (const il of allInvoiceLines) {
      const invoiceIds = il.fields["Invoice"] as string[] | undefined;
      if (!invoiceIds?.[0]) continue;
      const invoiceId = invoiceIds[0];
      const skuIds = il.fields["SKU"] as string[] | undefined;
      const skuId = skuIds?.[0] || null;
      const receiptLineLink = (il.fields["Receipt Line"] as string[] | undefined)?.[0] || null;

      if (receiptLineLink) {
        claimedReceiptLines.add(receiptLineLink);
      }

      if (!invoiceLinesByInvoice[invoiceId])
        invoiceLinesByInvoice[invoiceId] = [];
      invoiceLinesByInvoice[invoiceId].push({
        id: il.id,
        skuId,
        skuName: skuId ? itemMap[skuId]?.name || null : null,
        ansItemNumber: (il.fields["ANS Item Number"] as string) || null,
        qtyBilled: (il.fields["Qty Billed"] as number) || 0,
        unitCost: (il.fields["Unit Cost"] as number) || 0,
        amount: (il.fields["Amount"] as number) || 0,
        receiptLineId: receiptLineLink,
      });
    }

    // 3. Process each invoice

    interface ComparisonLine {
      skuId: string | null;
      skuName: string;
      invoiceQty: number;
      receiptQty: number;
      qtyMatch: boolean;
      invoiceUnitCost: number;
      poUnitCost: number;
      priceMatch: boolean;
      invoiceLineId: string;
      receiptLineId: string;
      poLineItemId: string;
    }

    interface ReceiptOption {
      receiptId: string;
      receiptNumber: string;
      receivedDate: string;
      overlapScore: number;
    }

    interface InvoiceMatchData {
      id: string;
      invoiceNumber: string;
      invoiceDate: string;
      dueDate: string;
      supplier: string;
      poReference: string;
      invoiceAmount: number;
      matchStatus: "open" | "matched" | "discrepancy";
      paymentStatus: string;
      lineCount: number;
      po: { poId: string; poNumber: string; status: string } | null;
      suggestedReceipt: {
        receiptId: string;
        receiptNumber: string;
        receivedDate: string;
      } | null;
      matchedReceipt: {
        receiptId: string;
        receiptNumber: string;
      } | null;
      receiptOptions: ReceiptOption[];
      comparison: {
        receiptId: string;
        lines: ComparisonLine[];
        allPass: boolean;
        discrepancyCount: number;
      } | null;
      flags: string[];
    }

    const invoices: InvoiceMatchData[] = [];

    for (const inv of allInvoices) {
      const poReference = (inv.fields["PO Reference"] as string) || "";
      const invoiceLines = invoiceLinesByInvoice[inv.id] || [];
      const flags: string[] = [];

      // Derive match status from line-level state and Airtable field
      const matchStatusField = (inv.fields["Match Status"] as string) || "";
      const matchStatus = normalizeMatchStatus(matchStatusField, invoiceLines);

      // Find PO
      let po: { poId: string; poNumber: string; status: string } | null = null;
      const poMatch = attemptPOMatch(poReference, poCandidates);
      if (poMatch) {
        const poData = poMap[poMatch.id];
        po = {
          poId: poMatch.id,
          poNumber: poData.poNumber,
          status: poData.status,
        };
      } else if (poReference) {
        // Try all POs (including non-matchable statuses)
        const allPOMatch = attemptPOMatch(
          poReference,
          allPOs.map((p) => ({
            id: p.id,
            poNumber: (p.fields["PO Number"] as string) || "",
          }))
        );
        if (allPOMatch) {
          const poData = poMap[allPOMatch.id];
          po = {
            poId: allPOMatch.id,
            poNumber: poData.poNumber,
            status: poData.status,
          };
        } else {
          flags.push(`No PO found for reference "${poReference}"`);
        }
      } else {
        flags.push("No PO reference on invoice");
      }

      // Find receipt options
      let receiptOptions: ReceiptOption[] = [];
      let suggestedReceipt: InvoiceMatchData["suggestedReceipt"] = null;
      let matchedReceipt: InvoiceMatchData["matchedReceipt"] = null;
      let comparison: InvoiceMatchData["comparison"] = null;

      if (po) {
        const poReceiptIds = receiptsByPO[po.poId] || [];

        if (poReceiptIds.length === 0) {
          flags.push(`No receipts matched to ${po.poNumber} yet`);
        } else {
          // Score each receipt by SKU+qty overlap with invoice lines
          receiptOptions = poReceiptIds.map((receiptId) => {
            const receipt = receiptMap[receiptId];
            const rLines = receiptLinesByReceipt[receiptId] || [];

            let overlapScore = 0;
            for (const il of invoiceLines) {
              if (!il.skuId) continue;
              const matchingRL = rLines.find((rl) => rl.skuId === il.skuId);
              if (matchingRL) {
                overlapScore += 1;
                if (matchingRL.qtyReceived === il.qtyBilled) {
                  overlapScore += 1;
                }
              }
            }

            return {
              receiptId,
              receiptNumber: receipt.receiptNumber,
              receivedDate: receipt.receivedDate,
              overlapScore,
            };
          });

          receiptOptions.sort((a, b) => b.overlapScore - a.overlapScore);

          // For matched/discrepancy invoices, derive the matched receipt from line-level links
          if (matchStatus === "matched" || matchStatus === "discrepancy") {
            // Find which receipt the invoice lines are linked to
            const linkedReceiptLineIds = invoiceLines
              .map((il) => il.receiptLineId)
              .filter(Boolean) as string[];

            if (linkedReceiptLineIds.length > 0) {
              // Find which receipt these receipt lines belong to
              for (const [receiptId, rLines] of Object.entries(receiptLinesByReceipt)) {
                const hasMatch = rLines.some((rl) =>
                  linkedReceiptLineIds.includes(rl.id)
                );
                if (hasMatch && receiptMap[receiptId]) {
                  matchedReceipt = {
                    receiptId,
                    receiptNumber: receiptMap[receiptId].receiptNumber,
                  };
                  break;
                }
              }
            }
          }

          // For open invoices, suggest the best receipt
          if (matchStatus === "open") {
            const best = receiptOptions[0];
            if (best && best.overlapScore > 0) {
              suggestedReceipt = {
                receiptId: best.receiptId,
                receiptNumber: best.receiptNumber,
                receivedDate: best.receivedDate,
              };
            }
          }

          // Build comparison for the suggested or matched receipt
          const comparisonReceiptId =
            matchedReceipt?.receiptId || suggestedReceipt?.receiptId;
          if (comparisonReceiptId) {
            comparison = buildComparison(
              invoiceLines,
              comparisonReceiptId,
              receiptLinesByReceipt,
              po.poId,
              poLinesByPO,
              itemMap
            );
          }
        }
      }

      const supplierId = (inv.fields["Supplier"] as string[] | undefined)?.[0];
      const invoiceDate = (inv.fields["Invoice Date"] as string) || "";
      const paymentTerms = (inv.fields["Payment Terms"] as string) || "";
      const dueDate =
        (inv.fields["Invoice Due Date"] as string) ||
        computeDueDate(invoiceDate, paymentTerms);

      invoices.push({
        id: inv.id,
        invoiceNumber: (inv.fields["Invoice Number"] as string) || "",
        invoiceDate,
        dueDate,
        supplier: supplierId ? supplierMap[supplierId] || "" : "",
        poReference,
        invoiceAmount: (inv.fields["Total Amount"] as number) || 0,
        matchStatus,
        paymentStatus: (inv.fields["Payment Status"] as string) || "Unpaid",
        lineCount: invoiceLines.length,
        po,
        suggestedReceipt,
        matchedReceipt,
        receiptOptions,
        comparison,
        flags,
      });
    }

    // Sort: open first, then discrepancy, then matched
    invoices.sort((a, b) => {
      const statusOrder = { open: 0, discrepancy: 1, matched: 2 };
      if (statusOrder[a.matchStatus] !== statusOrder[b.matchStatus]) {
        return statusOrder[a.matchStatus] - statusOrder[b.matchStatus];
      }
      return (b.invoiceDate || "").localeCompare(a.invoiceDate || "");
    });

    const counts = {
      open: invoices.filter((i) => i.matchStatus === "open").length,
      matched: invoices.filter((i) => i.matchStatus === "matched").length,
      discrepancy: invoices.filter((i) => i.matchStatus === "discrepancy").length,
    };

    return NextResponse.json({ invoices, counts });
  } catch (error) {
    console.error("Invoice matching error:", error);
    return NextResponse.json(
      {
        error: `Failed to load invoice matching data: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}

/**
 * Normalize match status.
 * Derives from Airtable field + line-level state.
 */
function normalizeMatchStatus(
  matchStatusField: string,
  invoiceLines: { receiptLineId: string | null }[]
): "open" | "matched" | "discrepancy" {
  const s = matchStatusField.toLowerCase();
  if (s === "matched") return "matched";
  if (s === "discrepancy") return "discrepancy";
  if (s === "open") return "open";

  // Legacy: derive from line-level links
  const hasLinks = invoiceLines.some((il) => il.receiptLineId);
  if (hasLinks) return "matched"; // legacy matched, assume clean
  return "open";
}

/**
 * Build comparison data for an invoice against a specific receipt.
 * Returns line-level comparison with receipt line IDs for linking.
 */
function buildComparison(
  invoiceLines: {
    id: string;
    skuId: string | null;
    skuName: string | null;
    qtyBilled: number;
    unitCost: number;
  }[],
  receiptId: string,
  receiptLinesByReceipt: Record<
    string,
    { id: string; skuId: string; qtyReceived: number }[]
  >,
  poId: string,
  poLinesByPO: Record<
    string,
    { id: string; skuId: string; qtyOrdered: number; unitCost: number }[]
  >,
  itemMap: Record<string, { name: string; uom: string }>
) {
  const receiptLines = receiptLinesByReceipt[receiptId] || [];
  const poLines = poLinesByPO[poId] || [];

  // Build receipt line lookup by SKU (with record ID)
  const receiptLineBySku: Record<
    string,
    { id: string; qtyReceived: number }
  > = {};
  for (const rl of receiptLines) {
    // If multiple receipt lines for same SKU, aggregate qty but keep first ID
    if (!receiptLineBySku[rl.skuId]) {
      receiptLineBySku[rl.skuId] = { id: rl.id, qtyReceived: rl.qtyReceived };
    } else {
      receiptLineBySku[rl.skuId].qtyReceived += rl.qtyReceived;
    }
  }

  // Build PO lookup by SKU
  const poUnitCostBySku: Record<string, number> = {};
  const poLineIdBySku: Record<string, string> = {};
  for (const pl of poLines) {
    poUnitCostBySku[pl.skuId] = pl.unitCost;
    poLineIdBySku[pl.skuId] = pl.id;
  }

  // Build comparison lines
  const lines: ComparisonLine[] = [];
  let discrepancyCount = 0;

  for (const il of invoiceLines) {
    if (!il.skuId) continue;

    const receiptLine = receiptLineBySku[il.skuId];
    const receiptQty = receiptLine?.qtyReceived || 0;
    const receiptLineId = receiptLine?.id || "";
    const poUnitCost = poUnitCostBySku[il.skuId] || 0;
    const poLineItemId = poLineIdBySku[il.skuId] || "";

    const qtyMatch = il.qtyBilled === receiptQty;
    const priceMatch = poUnitCost > 0 && il.unitCost === poUnitCost;

    if (!qtyMatch || !priceMatch) {
      discrepancyCount++;
    }

    lines.push({
      skuId: il.skuId,
      skuName: il.skuName || itemMap[il.skuId]?.name || il.skuId,
      invoiceQty: il.qtyBilled,
      receiptQty,
      qtyMatch,
      invoiceUnitCost: il.unitCost,
      poUnitCost,
      priceMatch,
      invoiceLineId: il.id,
      receiptLineId,
      poLineItemId,
    });
  }

  return {
    receiptId,
    lines,
    allPass: discrepancyCount === 0,
    discrepancyCount,
  };
}

interface ComparisonLine {
  skuId: string | null;
  skuName: string;
  invoiceQty: number;
  receiptQty: number;
  qtyMatch: boolean;
  invoiceUnitCost: number;
  poUnitCost: number;
  priceMatch: boolean;
  invoiceLineId: string;
  receiptLineId: string;
  poLineItemId: string;
}

/**
 * Compute due date from invoice date + payment terms.
 * Supports "Net X" format (e.g., "Net 30" → invoice date + 30 days).
 */
function computeDueDate(invoiceDate: string, paymentTerms: string): string {
  if (!invoiceDate) return "";
  const netMatch = paymentTerms.match(/^Net\s+(\d+)$/i);
  if (!netMatch) return "";
  const days = parseInt(netMatch[1], 10);
  const date = new Date(invoiceDate + "T00:00:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().split("T")[0];
}
