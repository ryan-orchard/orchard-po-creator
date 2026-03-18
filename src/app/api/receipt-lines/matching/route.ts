import { NextResponse } from "next/server";
import { getRecords, TABLES } from "@/lib/airtable";
import { attemptPOMatch } from "@/lib/po-matching";
import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";

const SKU_MAPPING: Record<
  string,
  { standardSku: string; airtableId: string } | null
> = skuMappingData as Record<
  string,
  { standardSku: string; airtableId: string } | null
>;

/**
 * GET /api/receipt-lines/matching
 *
 * Returns all receipt lines flattened with:
 * - Suggested PO matches (strict: exact item, exact qty, not yet received)
 * - Full PO option cards with all line items (for the expanded mini PO card view)
 */
export async function GET() {
  try {
    const [
      allReceipts,
      allReceiptLines,
      allPOs,
      allPOLineItems,
      allItems,
      allSuppliers,
    ] = await Promise.all([
      getRecords(TABLES.RECEIPTS, {
        sort: [{ field: "Received Date", direction: "desc" }],
      }),
      getRecords(TABLES.RECEIPT_LINES),
      getRecords(TABLES.PURCHASE_ORDERS, {
        sort: [{ field: "PO Number", direction: "asc" }],
      }),
      getRecords(TABLES.PO_LINE_ITEMS),
      getRecords(TABLES.SKUS),
      getRecords(TABLES.SUPPLIERS),
    ]);

    // --- Build lookups ---

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

    const supplierMap: Record<string, string> = {};
    for (const s of allSuppliers) {
      supplierMap[s.id] =
        (s.fields["Name"] as string) ||
        (s.fields["Code"] as string) ||
        s.id;
    }

    const receiptMap: Record<
      string,
      {
        receivedDate: string;
        externalReceiptId: string;
        receiptNumber: string;
        poId: string | null;
      }
    > = {};
    for (const r of allReceipts) {
      const poIds = r.fields["Purchase Order"] as string[] | undefined;
      receiptMap[r.id] = {
        receivedDate: (r.fields["Received Date"] as string) || "",
        externalReceiptId:
          (r.fields["External Receipt ID"] as string) || "",
        receiptNumber: (r.fields["Receipt Number"] as string) || "",
        poId: poIds?.[0] || null,
      };
    }

    const poMap: Record<
      string,
      { poNumber: string; status: string; date: string; supplierId: string | null }
    > = {};
    for (const po of allPOs) {
      const supplierIds = po.fields["Supplier"] as string[] | undefined;
      poMap[po.id] = {
        poNumber: (po.fields["PO Number"] as string) || "",
        status: (po.fields["Status"] as string) || "",
        date: (po.fields["Date"] as string) || "",
        supplierId: supplierIds?.[0] || null,
      };
    }

    // --- PO line items: build per-PO and per-PO-line-item lookups ---

    interface POLineItemInfo {
      id: string;
      poId: string;
      skuId: string;
      skuName: string;
      section: string;
      qtyOrdered: number;
    }

    const poLineItemMap: Record<string, POLineItemInfo> = {};
    const poLinesByPOId: Record<string, POLineItemInfo[]> = {};

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

      const info: POLineItemInfo = {
        id: li.id,
        poId,
        skuId,
        skuName: item?.name || skuId,
        section: (li.fields["Section"] as string) || "",
        qtyOrdered,
      };

      poLineItemMap[li.id] = info;
      if (!poLinesByPOId[poId]) poLinesByPOId[poId] = [];
      poLinesByPOId[poId].push(info);
    }

    // --- Calculate received qty per PO line item ---

    const receivedByPOLineItem: Record<string, number> = {};
    for (const rl of allReceiptLines) {
      const poLineItemLinks = rl.fields["PO Line Item"] as string[] | undefined;
      if (poLineItemLinks?.[0]) {
        const qty = (rl.fields["Qty Received"] as number) || 0;
        receivedByPOLineItem[poLineItemLinks[0]] =
          (receivedByPOLineItem[poLineItemLinks[0]] || 0) + qty;
      }
    }

    // --- Matchable POs ---

    const matchablePOIds = new Set(
      allPOs
        .filter((r) => {
          const status = r.fields["Status"] as string;
          return status === "Issued" || status === "Partially Received";
        })
        .map((r) => r.id)
    );

    const matchablePOCandidates = allPOs
      .filter((r) => matchablePOIds.has(r.id))
      .map((r) => ({
        id: r.id,
        poNumber: r.fields["PO Number"] as string,
      }));

    // --- Process each receipt line ---

    interface POOptionLineItem {
      poLineItemId: string;
      sku: string;
      skuId: string;
      section: string;
      qtyOrdered: number;
      qtyReceived: number;
      qtyRemaining: number;
      isMatchable: boolean;
    }

    interface POOption {
      poId: string;
      poNumber: string;
      poStatus: string;
      poDate: string;
      supplier: string;
      lineItems: POOptionLineItem[];
    }

    interface SuggestedMatch {
      poId: string;
      poNumber: string;
      poLineItemId: string;
      poQty: number;
      hasPartialReceipts: boolean;
    }

    interface MatchingLine {
      id: string;
      receiptId: string;
      receiptDate: string;
      orderNumber: string;
      receiptNumber: string;
      sku: string;
      skuId: string | null;
      threePlSku: string | null;
      receiptQty: number;
      status: "open" | "review" | "matched" | "excluded";
      reviewNote: string | null;
      suggestedMatch: SuggestedMatch | null;
      matchedPO: {
        poId: string;
        poNumber: string;
        poLineItemId: string;
      } | null;
      poOptions: POOption[];
    }

    const lines: MatchingLine[] = [];

    for (const rl of allReceiptLines) {
      const receiptIds = rl.fields["Receipt"] as string[] | undefined;
      if (!receiptIds?.[0]) continue;

      const receipt = receiptMap[receiptIds[0]];
      if (!receipt) continue;

      const poLineItemLinks = rl.fields["PO Line Item"] as string[] | undefined;
      const skuIds = rl.fields["SKU"] as string[] | undefined;
      const matchStatus = (rl.fields["Match Status"] as string) || "Open";

      // Resolve SKU
      let skuId = skuIds?.[0] || null;
      const threePlSku = (rl.fields["3PL SKU"] as string) || null;
      if (!skuId && threePlSku) {
        const mapping = SKU_MAPPING[threePlSku];
        if (mapping) skuId = mapping.airtableId;
      }

      const item = skuId ? itemMap[skuId] : null;
      const isMatched = !!(poLineItemLinks && poLineItemLinks.length > 0);

      let status: "open" | "review" | "matched" | "excluded";
      if (isMatched || matchStatus === "Matched") {
        status = "matched";
      } else if (matchStatus === "Excluded") {
        status = "excluded";
      } else if (matchStatus === "Review") {
        status = "review";
      } else {
        status = "open";
      }

      // --- Build PO options with full line item details (open + review) ---
      let suggestedMatch: SuggestedMatch | null = null;
      let poOptions: POOption[] = [];
      const reviewNote = (rl.fields["Review Notes"] as string) || null;

      if ((status === "open" || status === "review") && skuId) {
        // Find all matchable POs that have this SKU
        const relevantPOIds = new Set<string>();
        for (const poId of matchablePOIds) {
          const poLines = poLinesByPOId[poId] || [];
          const hasThisSku = poLines.some((pl) => pl.skuId === skuId);
          if (hasThisSku) relevantPOIds.add(poId);
        }

        // Build full PO option cards
        poOptions = [...relevantPOIds]
          .map((poId) => {
            const po = poMap[poId];
            const poLines = poLinesByPOId[poId] || [];

            const lineItems: POOptionLineItem[] = poLines.map((pl) => {
              const received = receivedByPOLineItem[pl.id] || 0;
              return {
                poLineItemId: pl.id,
                sku: pl.skuName,
                skuId: pl.skuId,
                section: pl.section,
                qtyOrdered: pl.qtyOrdered,
                qtyReceived: received,
                qtyRemaining: pl.qtyOrdered - received,
                isMatchable: pl.skuId === skuId && pl.qtyOrdered - received > 0,
              };
            });

            return {
              poId,
              poNumber: po.poNumber,
              poStatus: po.status,
              poDate: po.date,
              supplier: po.supplierId
                ? supplierMap[po.supplierId] || ""
                : "",
              lineItems,
            };
          })
          .sort((a, b) =>
            a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true })
          );

        // --- Strict auto-suggestion logic ---
        // Only suggest if: exact SKU match, exact qty, not yet received
        type CleanMatch = {
          poId: string;
          poNumber: string;
          poLineItemId: string;
          poQty: number;
        };
        const cleanMatches: CleanMatch[] = [];

        for (const poOpt of poOptions) {
          for (const li of poOpt.lineItems) {
            if (
              li.skuId === skuId &&
              li.qtyOrdered === (rl.fields["Qty Received"] as number) &&
              li.qtyReceived === 0
            ) {
              cleanMatches.push({
                poId: poOpt.poId,
                poNumber: poOpt.poNumber,
                poLineItemId: li.poLineItemId,
                poQty: li.qtyOrdered,
              });
            }
          }
        }

        // Tier 1: PO number from External Receipt ID → suggest that PO
        const poMatch = attemptPOMatch(
          receipt.externalReceiptId,
          matchablePOCandidates
        );
        if (poMatch) {
          // Find the matchable line item on this PO for the receipt's SKU
          const matchedPOOpt = poOptions.find((o) => o.poId === poMatch.id);
          const matchableLine = matchedPOOpt?.lineItems.find(
            (li) => li.skuId === skuId && li.qtyRemaining > 0
          );
          if (matchableLine) {
            suggestedMatch = {
              poId: poMatch.id,
              poNumber: matchedPOOpt!.poNumber,
              poLineItemId: matchableLine.poLineItemId,
              poQty: matchableLine.qtyOrdered,
              hasPartialReceipts: matchableLine.qtyReceived > 0,
            };
          }
        }

        // Tier 2: Exactly one clean match → suggest it
        if (!suggestedMatch && cleanMatches.length === 1) {
          suggestedMatch = { ...cleanMatches[0], hasPartialReceipts: false };
        }

        // If there are PO options with partial receipts, flag it
        // (no auto-suggestion for partial receipt POs)
      }

      // --- For matched lines, resolve PO info ---
      let matchedPO: {
        poId: string;
        poNumber: string;
        poLineItemId: string;
      } | null = null;
      if (isMatched && poLineItemLinks?.[0]) {
        const plInfo = poLineItemMap[poLineItemLinks[0]];
        if (plInfo) {
          const po = poMap[plInfo.poId];
          matchedPO = {
            poId: plInfo.poId,
            poNumber: po?.poNumber || plInfo.poId,
            poLineItemId: poLineItemLinks[0],
          };
        }
      }

      lines.push({
        id: rl.id,
        receiptId: receiptIds[0],
        receiptDate: receipt.receivedDate,
        orderNumber: receipt.externalReceiptId,
        receiptNumber: receipt.receiptNumber,
        sku: item?.name || threePlSku || "Unknown",
        skuId,
        threePlSku,
        receiptQty: (rl.fields["Qty Received"] as number) || 0,
        status,
        reviewNote,
        suggestedMatch,
        matchedPO,
        poOptions,
      });
    }

    // Sort: open first, then review, then matched, then excluded
    lines.sort((a, b) => {
      const statusOrder = { open: 0, review: 1, matched: 2, excluded: 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return (b.receiptDate || "").localeCompare(a.receiptDate || "");
    });

    const counts = {
      open: lines.filter((l) => l.status === "open").length,
      review: lines.filter((l) => l.status === "review").length,
      matched: lines.filter((l) => l.status === "matched").length,
      excluded: lines.filter((l) => l.status === "excluded").length,
    };

    return NextResponse.json({ lines, counts });
  } catch (error) {
    console.error("Receipt lines matching error:", error);
    return NextResponse.json(
      {
        error: `Failed to load matching data: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
