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
 * - Suggested PO or WO matches
 * - Full PO/WO option cards with all line items
 */
export async function GET() {
  try {
    const [
      allReceipts,
      allReceiptLines,
      allPOs,
      allPOLineItems,
      allWOs,
      allWOLines,
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
      getRecords(TABLES.WORK_ORDERS, {
        sort: [{ field: "WO Number", direction: "asc" }],
      }),
      getRecords(TABLES.WORK_ORDER_LINES),
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
        orderNumber: string;
        receiptNumber: string;
        poId: string | null;
        woId: string | null;
      }
    > = {};
    for (const r of allReceipts) {
      const poIds = r.fields["Purchase Order"] as string[] | undefined;
      const woIds = r.fields["Work Order"] as string[] | undefined;
      const externalId = (r.fields["External Receipt ID"] as string) || "";
      const notes = (r.fields["Notes"] as string) || "";
      const notesMatch = notes.match(/^Order:\s*(.+?)(?:\s*\||$)/);
      const orderNumber = notesMatch ? notesMatch[1].trim() : externalId;
      receiptMap[r.id] = {
        receivedDate: (r.fields["Received Date"] as string) || "",
        externalReceiptId: externalId,
        orderNumber,
        receiptNumber: (r.fields["Receipt Number"] as string) || "",
        poId: poIds?.[0] || null,
        woId: woIds?.[0] || null,
      };
    }

    // --- PO lookups ---

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

    const receivedByPOLineItem: Record<string, number> = {};
    for (const rl of allReceiptLines) {
      const poLineItemLinks = rl.fields["PO Line Item"] as string[] | undefined;
      if (poLineItemLinks?.[0]) {
        const qty = (rl.fields["Qty Received"] as number) || 0;
        receivedByPOLineItem[poLineItemLinks[0]] =
          (receivedByPOLineItem[poLineItemLinks[0]] || 0) + qty;
      }
    }

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

    // --- WO lookups ---

    const woMap: Record<
      string,
      { woNumber: string; status: string; description: string }
    > = {};
    for (const wo of allWOs) {
      woMap[wo.id] = {
        woNumber: (wo.fields["WO Number"] as string) || "",
        status: (wo.fields["Status"] as string) || "",
        description: (wo.fields["Notes"] as string) || "",
      };
    }

    interface WOLineItemInfo {
      id: string;
      woId: string;
      skuId: string;
      skuName: string;
      lineType: string;
      qty: number;
    }

    const woLineItemMap: Record<string, WOLineItemInfo> = {};
    const woOutputLinesByWOId: Record<string, WOLineItemInfo[]> = {};

    for (const wl of allWOLines) {
      const woLinks = wl.fields["Work Order"] as string[] | undefined;
      const skuLinks = wl.fields["SKU"] as string[] | undefined;
      if (!woLinks?.[0] || !skuLinks?.[0]) continue;

      const woId = woLinks[0];
      const skuId = skuLinks[0];
      const lineType = (wl.fields["Line Type"] as string) || "";
      const item = itemMap[skuId];

      const info: WOLineItemInfo = {
        id: wl.id,
        woId,
        skuId,
        skuName: item?.name || skuId,
        lineType,
        qty: (wl.fields["Quantity"] as number) || 0,
      };

      woLineItemMap[wl.id] = info;
      // Only output lines are matchable to receipts (outputs are what gets shipped/received)
      if (lineType === "Output") {
        if (!woOutputLinesByWOId[woId]) woOutputLinesByWOId[woId] = [];
        woOutputLinesByWOId[woId].push(info);
      }
    }

    // Calculate received qty per WO output line
    const receivedByWOLineItem: Record<string, number> = {};
    for (const rl of allReceiptLines) {
      const woLineItemLinks = rl.fields["Work Order Lines"] as string[] | undefined;
      if (woLineItemLinks?.[0]) {
        const qty = (rl.fields["Qty Received"] as number) || 0;
        receivedByWOLineItem[woLineItemLinks[0]] =
          (receivedByWOLineItem[woLineItemLinks[0]] || 0) + qty;
      }
    }

    // Matchable WOs: Completed status with output lines that have remaining qty
    const matchableWOIds = new Set(
      allWOs
        .filter((wo) => {
          const status = wo.fields["Status"] as string;
          return status === "Completed" || status === "Issued" || status === "In Progress";
        })
        .map((wo) => wo.id)
    );

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

    interface WOOptionLineItem {
      woLineItemId: string;
      sku: string;
      skuId: string;
      qty: number;
      qtyReceived: number;
      qtyRemaining: number;
      isMatchable: boolean;
    }

    interface WOOption {
      woId: string;
      woNumber: string;
      woStatus: string;
      description: string;
      lineItems: WOOptionLineItem[];
    }

    interface SuggestedMatch {
      type: "po" | "wo";
      sourceId: string;
      sourceNumber: string;
      lineItemId: string;
      qty: number;
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
      matchedWO: {
        woId: string;
        woNumber: string;
        woLineItemId: string;
      } | null;
      poOptions: POOption[];
      woOptions: WOOption[];
    }

    const lines: MatchingLine[] = [];

    for (const rl of allReceiptLines) {
      const receiptIds = rl.fields["Receipt"] as string[] | undefined;
      if (!receiptIds?.[0]) continue;

      const receipt = receiptMap[receiptIds[0]];
      if (!receipt) continue;

      const poLineItemLinks = rl.fields["PO Line Item"] as string[] | undefined;
      const woLineItemLinks = rl.fields["Work Order Lines"] as string[] | undefined;
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
      const isPOMatched = !!(poLineItemLinks && poLineItemLinks.length > 0);
      const isWOMatched = !!(woLineItemLinks && woLineItemLinks.length > 0);
      const isMatched = isPOMatched || isWOMatched;

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

      // --- Build PO + WO options for open/review lines ---
      let suggestedMatch: SuggestedMatch | null = null;
      let poOptions: POOption[] = [];
      let woOptions: WOOption[] = [];
      const reviewNote = (rl.fields["Review Notes"] as string) || null;

      if ((status === "open" || status === "review") && skuId) {
        // --- PO options ---
        const relevantPOIds = new Set<string>();
        for (const poId of matchablePOIds) {
          const poLines = poLinesByPOId[poId] || [];
          const hasThisSku = poLines.some((pl) => pl.skuId === skuId);
          if (hasThisSku) relevantPOIds.add(poId);
        }

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

        // --- WO options ---
        const relevantWOIds = new Set<string>();
        for (const woId of matchableWOIds) {
          const woLines = woOutputLinesByWOId[woId] || [];
          const hasThisSku = woLines.some((wl) => wl.skuId === skuId);
          if (hasThisSku) relevantWOIds.add(woId);
        }

        woOptions = [...relevantWOIds]
          .map((woId) => {
            const wo = woMap[woId];
            const woLines = woOutputLinesByWOId[woId] || [];

            const lineItems: WOOptionLineItem[] = woLines.map((wl) => {
              const received = receivedByWOLineItem[wl.id] || 0;
              return {
                woLineItemId: wl.id,
                sku: wl.skuName,
                skuId: wl.skuId,
                qty: wl.qty,
                qtyReceived: received,
                qtyRemaining: wl.qty - received,
                isMatchable: wl.skuId === skuId && wl.qty - received > 0,
              };
            });

            return {
              woId,
              woNumber: wo.woNumber,
              woStatus: wo.status,
              description: wo.description,
              lineItems,
            };
          })
          .sort((a, b) =>
            a.woNumber.localeCompare(b.woNumber, undefined, { numeric: true })
          );

        // --- Auto-suggestion: PO first, then WO ---

        // PO Tier 1: PO number from order number
        const poMatch = attemptPOMatch(
          receipt.orderNumber,
          matchablePOCandidates
        );
        if (poMatch) {
          const matchedPOOpt = poOptions.find((o) => o.poId === poMatch.id);
          const matchableLine = matchedPOOpt?.lineItems.find(
            (li) => li.skuId === skuId && li.qtyRemaining > 0
          );
          if (matchableLine) {
            suggestedMatch = {
              type: "po",
              sourceId: poMatch.id,
              sourceNumber: matchedPOOpt!.poNumber,
              lineItemId: matchableLine.poLineItemId,
              qty: matchableLine.qtyOrdered,
              hasPartialReceipts: matchableLine.qtyReceived > 0,
            };
          }
        }

        // PO Tier 2: Exactly one clean PO match (exact SKU + qty, no prior receipts)
        if (!suggestedMatch) {
          type CleanMatch = {
            sourceId: string;
            sourceNumber: string;
            lineItemId: string;
            qty: number;
          };
          const cleanPOMatches: CleanMatch[] = [];
          for (const poOpt of poOptions) {
            for (const li of poOpt.lineItems) {
              if (
                li.skuId === skuId &&
                li.qtyOrdered === (rl.fields["Qty Received"] as number) &&
                li.qtyReceived === 0
              ) {
                cleanPOMatches.push({
                  sourceId: poOpt.poId,
                  sourceNumber: poOpt.poNumber,
                  lineItemId: li.poLineItemId,
                  qty: li.qtyOrdered,
                });
              }
            }
          }
          if (cleanPOMatches.length === 1) {
            suggestedMatch = { type: "po", ...cleanPOMatches[0], hasPartialReceipts: false };
          }
        }

        // WO Tier: Exactly one clean WO match (exact SKU + qty, no prior receipts)
        if (!suggestedMatch) {
          type CleanWOMatch = {
            sourceId: string;
            sourceNumber: string;
            lineItemId: string;
            qty: number;
          };
          const cleanWOMatches: CleanWOMatch[] = [];
          for (const woOpt of woOptions) {
            for (const li of woOpt.lineItems) {
              if (
                li.skuId === skuId &&
                li.qty === (rl.fields["Qty Received"] as number) &&
                li.qtyReceived === 0
              ) {
                cleanWOMatches.push({
                  sourceId: woOpt.woId,
                  sourceNumber: woOpt.woNumber,
                  lineItemId: li.woLineItemId,
                  qty: li.qty,
                });
              }
            }
          }
          if (cleanWOMatches.length === 1) {
            suggestedMatch = { type: "wo", ...cleanWOMatches[0], hasPartialReceipts: false };
          }
        }
      }

      // --- For matched lines, resolve PO or WO info ---
      let matchedPO: {
        poId: string;
        poNumber: string;
        poLineItemId: string;
      } | null = null;
      if (isPOMatched && poLineItemLinks?.[0]) {
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

      let matchedWO: {
        woId: string;
        woNumber: string;
        woLineItemId: string;
      } | null = null;
      if (isWOMatched && woLineItemLinks?.[0]) {
        const wlInfo = woLineItemMap[woLineItemLinks[0]];
        if (wlInfo) {
          const wo = woMap[wlInfo.woId];
          matchedWO = {
            woId: wlInfo.woId,
            woNumber: wo?.woNumber || wlInfo.woId,
            woLineItemId: woLineItemLinks[0],
          };
        }
      }

      lines.push({
        id: rl.id,
        receiptId: receiptIds[0],
        receiptDate: receipt.receivedDate,
        orderNumber: receipt.orderNumber,
        receiptNumber: receipt.receiptNumber,
        sku: item?.name || threePlSku || "Unknown",
        skuId,
        threePlSku,
        receiptQty: (rl.fields["Qty Received"] as number) || 0,
        status,
        reviewNote,
        suggestedMatch,
        matchedPO,
        matchedWO,
        poOptions,
        woOptions,
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
