import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, TABLES } from "@/lib/airtable";
import { attemptPOMatch } from "@/lib/po-matching";

/**
 * GET /api/invoices/[id]/suggest-po
 *
 * Returns the invoice details, a suggested PO match, and a 3-way comparison
 * table (PO ordered vs Receipt received vs Invoice billed).
 * Also accepts ?poId=xxx to get comparison for a specific PO.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: invoiceId } = await params;
    const { searchParams } = new URL(request.url);
    const specificPoId = searchParams.get("poId");

    // 1. Fetch the invoice
    const invoice = await getRecord(TABLES.INVOICES, invoiceId);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // 2. Fetch all data in parallel
    const [allInvoiceLines, allPOs, allPOLineItems, allItems, allReceipts, allReceiptLines] =
      await Promise.all([
        getRecords(TABLES.INVOICE_LINES),
        getRecords(TABLES.PURCHASE_ORDERS, {
          sort: [{ field: "PO Number", direction: "desc" }],
        }),
        getRecords(TABLES.PO_LINE_ITEMS),
        getRecords(TABLES.SKUS),
        getRecords(TABLES.RECEIPTS),
        getRecords(TABLES.RECEIPT_LINES),
      ]);

    // Filter invoice lines for THIS invoice
    const thisInvoiceLines = allInvoiceLines.filter((il) => {
      const invoiceIds = il.fields["Invoice"] as string[] | undefined;
      return invoiceIds?.[0] === invoiceId;
    });

    // Build item lookups
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

    // Build PO line items grouped by PO record ID
    const poLinesByPO: Record<
      string,
      {
        id: string;
        skuId: string;
        qtySticks: number;
        qtyCartons: number | null;
      }[]
    > = {};
    for (const li of allPOLineItems) {
      const poLinks = li.fields["Purchase Order"] as string[] | undefined;
      const skuLinks = li.fields["SKU"] as string[] | undefined;
      if (!poLinks?.[0] || !skuLinks?.[0]) continue;
      const poId = poLinks[0];
      if (!poLinesByPO[poId]) poLinesByPO[poId] = [];
      poLinesByPO[poId].push({
        id: li.id,
        skuId: skuLinks[0],
        qtySticks: (li.fields["Qty Sticks"] as number) || 0,
        qtyCartons: (li.fields["Qty Cartons"] as number) || null,
      });
    }

    // Matchable POs (Issued, Partially Received, or Received — invoices can come after receiving)
    const matchablePOs = allPOs
      .filter((r) => {
        const status = r.fields["Status"] as string;
        return (
          status === "Issued" ||
          status === "Partially Received" ||
          status === "Received"
        );
      })
      .map((r) => ({
        id: r.id,
        poNumber: r.fields["PO Number"] as string,
        status: r.fields["Status"] as string,
        lineItems: poLinesByPO[r.id] || [],
      }));

    // 3. Attempt auto-match using PO Reference text
    const poReference = (invoice.fields["PO Reference"] as string) || "";
    const suggestedMatch = attemptPOMatch(
      poReference,
      matchablePOs.map((po) => ({ id: po.id, poNumber: po.poNumber }))
    );

    // 4. Build invoice line details
    const invoiceLines = thisInvoiceLines.map((il) => {
      const skuIds = il.fields["SKU"] as string[] | undefined;
      const skuId = skuIds?.[0] || null;
      const poLineItemLink = il.fields["PO Line Item"] as string[] | undefined;
      const alreadyMatched = !!(poLineItemLink && poLineItemLink.length > 0);
      const item = skuId ? itemMap[skuId] : null;

      return {
        id: il.id,
        skuId,
        skuName: item?.name || null,
        uom: item?.uom || null,
        ansItemNumber: (il.fields["ANS Item Number"] as string) || null,
        qtyBilled: (il.fields["Qty Billed"] as number) || 0,
        unitCost: (il.fields["Unit Cost"] as number) || 0,
        amount: (il.fields["Amount"] as number) || 0,
        batchNumber: (il.fields["Batch Number"] as string) || null,
        matched: alreadyMatched,
      };
    });

    // Only use unmatched lines for comparison and PO scoring
    const unmatchedInvoiceLines = invoiceLines.filter((il) => !il.matched);

    // 5. Build 3-way comparison data for the suggested PO (or specific PO)
    const comparisonPoId = specificPoId || suggestedMatch?.id;
    let comparison = null;

    if (comparisonPoId) {
      const po = matchablePOs.find((p) => p.id === comparisonPoId);
      if (po) {
        // Get receipts linked to this PO
        const poReceiptIds = allReceipts
          .filter((r) => {
            const poIds = r.fields["Purchase Order"] as string[] | undefined;
            return poIds?.[0] === comparisonPoId;
          })
          .map((r) => r.id);

        // Get receipt lines for those receipts, aggregate received qty by SKU
        const receivedBySku: Record<string, number> = {};
        for (const rl of allReceiptLines) {
          const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
          if (
            rlReceiptIds?.[0] &&
            poReceiptIds.includes(rlReceiptIds[0])
          ) {
            const skuIds = rl.fields["SKU"] as string[] | undefined;
            const skuId = skuIds?.[0];
            if (skuId) {
              receivedBySku[skuId] =
                (receivedBySku[skuId] || 0) +
                ((rl.fields["Qty Received"] as number) || 0);
            }
          }
        }

        // Build invoice qty lookup by SKU (unmatched lines only)
        const invoiceQtyBySku: Record<string, number> = {};
        const invoiceCostBySku: Record<string, number> = {};
        const invoiceAmountBySku: Record<string, number> = {};
        const invoiceLineIdBySku: Record<string, string[]> = {};
        for (const il of unmatchedInvoiceLines) {
          if (il.skuId) {
            invoiceQtyBySku[il.skuId] =
              (invoiceQtyBySku[il.skuId] || 0) + il.qtyBilled;
            invoiceCostBySku[il.skuId] = il.unitCost; // last wins (same item = same price)
            invoiceAmountBySku[il.skuId] =
              (invoiceAmountBySku[il.skuId] || 0) + il.amount;
            if (!invoiceLineIdBySku[il.skuId])
              invoiceLineIdBySku[il.skuId] = [];
            invoiceLineIdBySku[il.skuId].push(il.id);
          }
        }

        // Build comparison lines
        type ComparisonLine = {
          poLineItemId: string;
          skuId: string | null;
          skuName: string;
          uom: string;
          qtyOrdered: number;
          qtyReceived: number;
          qtyBilled: number;
          variance: number; // billed - received
          unitCost: number;
          amount: number;
          invoiceLineIds: string[];
        };
        const matchedLines: ComparisonLine[] = [];
        const otherLines: ComparisonLine[] = [];
        const processedSkuIds = new Set<string>();

        for (const poLine of po.lineItems) {
          const item = itemMap[poLine.skuId];
          const uom = item?.uom || "Each";
          // UOM-aware ordered qty (same logic as receipt matching)
          const qtyOrdered =
            uom === "Carton"
              ? poLine.qtyCartons || 0
              : poLine.qtySticks || poLine.qtyCartons || 0;
          const qtyReceived = receivedBySku[poLine.skuId] || 0;
          const qtyBilled = invoiceQtyBySku[poLine.skuId] || 0;
          const variance = qtyBilled - qtyReceived;
          const lineInvoiceIds = invoiceLineIdBySku[poLine.skuId] || [];

          const line: ComparisonLine = {
            poLineItemId: poLine.id,
            skuId: poLine.skuId,
            skuName: item?.name || poLine.skuId,
            uom,
            qtyOrdered,
            qtyReceived,
            qtyBilled,
            variance,
            unitCost: invoiceCostBySku[poLine.skuId] || 0,
            amount: invoiceAmountBySku[poLine.skuId] || 0,
            invoiceLineIds: lineInvoiceIds,
          };

          if (qtyBilled > 0) {
            matchedLines.push(line);
          } else {
            otherLines.push(line);
          }
          processedSkuIds.add(poLine.skuId);
        }

        // Invoice lines for SKUs NOT on the PO
        for (const il of unmatchedInvoiceLines) {
          if (il.skuId && !processedSkuIds.has(il.skuId)) {
            const item = itemMap[il.skuId];
            matchedLines.push({
              poLineItemId: "",
              skuId: il.skuId,
              skuName: item?.name || il.skuId,
              uom: item?.uom || "Each",
              qtyOrdered: 0,
              qtyReceived: 0,
              qtyBilled: il.qtyBilled,
              variance: il.qtyBilled,
              unitCost: il.unitCost,
              amount: il.amount,
              invoiceLineIds: [il.id],
            });
            processedSkuIds.add(il.skuId);
          }
        }

        comparison = {
          poId: po.id,
          poNumber: po.poNumber,
          poStatus: po.status,
          matchedLines,
          otherLines,
        };
      }
    }

    // 6. Score and rank POs by SKU overlap with unmatched invoice lines
    const invoiceSkuIds = new Set(
      unmatchedInvoiceLines.map((il) => il.skuId).filter(Boolean)
    );

    const scoredPOs = matchablePOs
      .map((po) => {
        const poSkuIds = new Set(po.lineItems.map((li) => li.skuId));
        const overlapping = [...invoiceSkuIds].filter((skuId) =>
          poSkuIds.has(skuId!)
        );
        const overlapCount = overlapping.length;
        const overlapSkuNames = overlapping
          .map((skuId) => itemMap[skuId!]?.name || skuId)
          .filter(Boolean) as string[];
        const isExternalMatch = suggestedMatch?.id === po.id;
        const score = (isExternalMatch ? 100 : 0) + overlapCount;

        return {
          id: po.id,
          poNumber: po.poNumber,
          status: po.status,
          skuCount: po.lineItems.length,
          overlapCount,
          overlapSkuNames,
          score,
          skuNames: po.lineItems.map(
            (li) => itemMap[li.skuId]?.name || li.skuId
          ),
        };
      })
      .filter((po) => po.score > 0)
      .sort((a, b) => b.score - a.score);

    const otherPOs = matchablePOs
      .filter((po) => !scoredPOs.some((sp) => sp.id === po.id))
      .map((po) => ({
        id: po.id,
        poNumber: po.poNumber,
        status: po.status,
        skuCount: po.lineItems.length,
        overlapCount: 0,
        overlapSkuNames: [] as string[],
        score: 0,
        skuNames: po.lineItems.map(
          (li) => itemMap[li.skuId]?.name || li.skuId
        ),
      }));

    const bestMatch = scoredPOs.length > 0 ? scoredPOs[0] : null;

    return NextResponse.json({
      invoice: {
        id: invoice.id,
        invoiceNumber:
          (invoice.fields["Invoice Number"] as string) || "",
        poReference,
        invoiceDate:
          (invoice.fields["Invoice Date"] as string) || "",
        totalAmount:
          (invoice.fields["Total Amount"] as number) || 0,
      },
      invoiceLines,
      suggestedPO: bestMatch
        ? { id: bestMatch.id, poNumber: bestMatch.poNumber }
        : null,
      comparison,
      rankedPOs: scoredPOs,
      otherPOs,
    });
  } catch (error) {
    console.error("Suggest PO error:", error);
    return NextResponse.json(
      {
        error: `Failed to suggest PO: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
