import { NextRequest, NextResponse } from "next/server";
import { getRecord, getRecords, TABLES } from "@/lib/airtable";
import { attemptPOMatch } from "@/lib/po-matching";

// Stord SKU -> Standard SKU mapping (for resolving receipt lines without SKU links)
import skuMappingData from "@/../clients/magna/config/stord-sku-mapping.json";
const SKU_MAPPING: Record<string, { standardSku: string; airtableId: string } | null> =
  skuMappingData as Record<string, { standardSku: string; airtableId: string } | null>;

/**
 * GET /api/receipts/[id]/suggest-po
 *
 * Returns the receipt details, a suggested PO match, and comparison data
 * for the matching UI. Also accepts ?poId=xxx to get comparison for a specific PO.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: receiptId } = await params;
    const { searchParams } = new URL(request.url);
    const specificPoId = searchParams.get("poId");

    // 1. Fetch the receipt
    const receipt = await getRecord(TABLES.RECEIPTS, receiptId);
    if (!receipt) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    // 2. Fetch all data in parallel (receipt lines, POs, PO line items, items, all receipts)
    const [allReceiptLinesRaw, allPOs, allPOLineItems, allItems, allReceipts] = await Promise.all([
      getRecords(TABLES.RECEIPT_LINES),
      getRecords(TABLES.PURCHASE_ORDERS, {
        sort: [{ field: "PO Number", direction: "desc" }],
      }),
      getRecords(TABLES.PO_LINE_ITEMS),
      getRecords(TABLES.SKUS),
      getRecords(TABLES.RECEIPTS),
    ]);

    // Filter receipt lines for THIS receipt (linked record fields return record IDs in JS)
    const thisReceiptLines = allReceiptLinesRaw.filter((rl) => {
      const receiptIds = rl.fields["Receipt"] as string[] | undefined;
      return receiptIds?.[0] === receiptId;
    });

    // Build item lookups
    const itemMap: Record<string, { name: string; uom: string; sticksPerCarton: number | null }> = {};
    for (const item of allItems) {
      itemMap[item.id] = {
        name: (item.fields["Standard SKU"] as string) || (item.fields["Name"] as string) || item.id,
        uom: (item.fields["UOM"] as string) || "Each",
        sticksPerCarton: (item.fields["Sticks per Carton"] as number) || null,
      };
    }

    // Build PO line items grouped by PO record ID (include record ID for line-level matching)
    const poLinesByPO: Record<string, { id: string; skuId: string; qtySticks: number; qtyCartons: number | null }[]> = {};
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

    // Matchable POs (Issued or Partially Received)
    const matchablePOs = allPOs
      .filter((r) => {
        const status = r.fields["Status"] as string;
        return status === "Issued" || status === "Partially Received";
      })
      .map((r) => ({
        id: r.id,
        poNumber: r.fields["PO Number"] as string,
        status: r.fields["Status"] as string,
        lineItems: poLinesByPO[r.id] || [],
      }));

    // 4. Attempt auto-match using External Receipt ID
    const externalReceiptId = (receipt.fields["External Receipt ID"] as string) || "";
    const suggestedMatch = attemptPOMatch(
      externalReceiptId,
      matchablePOs.map((po) => ({ id: po.id, poNumber: po.poNumber }))
    );

    // 5. Build receipt line details (resolve SKU from 3PL SKU mapping if no direct link)
    // Include "matched" flag for lines already linked to a PO Line Item
    const receiptLines = thisReceiptLines.map((rl) => {
      const skuIds = rl.fields["SKU"] as string[] | undefined;
      let skuId = skuIds?.[0] || null;
      const threePlSku = (rl.fields["3PL SKU"] as string) || null;
      const poLineItemLink = rl.fields["PO Line Item"] as string[] | undefined;
      const alreadyMatched = !!(poLineItemLink && poLineItemLink.length > 0);

      // Fallback: resolve from 3PL SKU mapping if no direct SKU link
      if (!skuId && threePlSku) {
        const mapping = SKU_MAPPING[threePlSku];
        if (mapping) skuId = mapping.airtableId;
      }

      const item = skuId ? itemMap[skuId] : null;
      return {
        id: rl.id,
        skuId,
        skuName: item?.name || null,
        uom: item?.uom || null,
        qtyReceived: (rl.fields["Qty Received"] as number) || 0,
        threePlSku,
        lotNumber: (rl.fields["Lot Number"] as string) || null,
        matched: alreadyMatched,
      };
    });

    // Only use unmatched lines for comparison and PO scoring
    const unmatchedReceiptLines = receiptLines.filter((rl) => !rl.matched);

    // 6. Build comparison data for the suggested PO (or specific PO if requested)
    const comparisonPoId = specificPoId || suggestedMatch?.id;
    let comparison = null;

    if (comparisonPoId) {
      const po = matchablePOs.find((p) => p.id === comparisonPoId);
      if (po) {
        // Get all OTHER receipts already matched to this PO (not including current one)
        const otherReceiptIds = allReceipts
          .filter((r) => {
            const poIds = r.fields["Purchase Order"] as string[] | undefined;
            return poIds?.[0] === comparisonPoId && r.id !== receiptId;
          })
          .map((r) => r.id);

        // Get receipt lines for those other receipts
        const otherReceiptLines = allReceiptLinesRaw.filter((rl) => {
          const rlReceiptIds = rl.fields["Receipt"] as string[] | undefined;
          return rlReceiptIds?.[0] && otherReceiptIds.includes(rlReceiptIds[0]);
        });

        // Aggregate already-received qty by SKU from other receipts
        const alreadyReceivedBySku: Record<string, number> = {};
        for (const rl of otherReceiptLines) {
          const skuIds = rl.fields["SKU"] as string[] | undefined;
          const skuId = skuIds?.[0];
          if (skuId) {
            alreadyReceivedBySku[skuId] = (alreadyReceivedBySku[skuId] || 0) + ((rl.fields["Qty Received"] as number) || 0);
          }
        }

        // Build receipt qty lookup using UNMATCHED lines only
        const receiptQtyBySku: Record<string, number> = {};
        const receiptLineIdBySku: Record<string, string[]> = {};
        for (const rl of unmatchedReceiptLines) {
          if (rl.skuId) {
            receiptQtyBySku[rl.skuId] = (receiptQtyBySku[rl.skuId] || 0) + rl.qtyReceived;
            if (!receiptLineIdBySku[rl.skuId]) receiptLineIdBySku[rl.skuId] = [];
            receiptLineIdBySku[rl.skuId].push(rl.id);
          }
        }

        // Split PO lines into matched (SKU overlap with receipt) and other (no overlap)
        type ComparisonLine = {
          poLineItemId: string;
          skuId: string | null;
          skuName: string;
          uom: string;
          qtyOrdered: number;
          qtyAlreadyReceived: number;
          qtyThisReceipt: number;
          variance: number;
          receiptLineIds: string[];
        };
        const matchedLines: ComparisonLine[] = [];
        const otherLines: ComparisonLine[] = [];
        const processedSkuIds = new Set<string>();

        for (const poLine of po.lineItems) {
          const item = itemMap[poLine.skuId];
          const uom = item?.uom || "Each";
          // Use Qty Cartons for Carton items, Qty Sticks for Stick items,
          // and fall back to Qty Cartons for Each items (PO Creator stores qty there)
          const qtyOrdered = uom === "Carton"
            ? (poLine.qtyCartons || 0)
            : (poLine.qtySticks || poLine.qtyCartons || 0);
          const qtyAlreadyReceived = alreadyReceivedBySku[poLine.skuId] || 0;
          const qtyThisReceipt = receiptQtyBySku[poLine.skuId] || 0;
          const remaining = qtyOrdered - qtyAlreadyReceived;
          const variance = qtyThisReceipt - remaining;
          const lineReceiptIds = receiptLineIdBySku[poLine.skuId] || [];

          const line: ComparisonLine = {
            poLineItemId: poLine.id,
            skuId: poLine.skuId,
            skuName: item?.name || poLine.skuId,
            uom,
            qtyOrdered,
            qtyAlreadyReceived,
            qtyThisReceipt,
            variance,
            receiptLineIds: lineReceiptIds,
          };

          if (qtyThisReceipt > 0) {
            matchedLines.push(line);
          } else {
            otherLines.push(line);
          }
          processedSkuIds.add(poLine.skuId);
        }

        // Unmatched receipt lines for SKUs NOT on the PO
        for (const rl of unmatchedReceiptLines) {
          if (rl.skuId && !processedSkuIds.has(rl.skuId)) {
            const item = itemMap[rl.skuId];
            matchedLines.push({
              poLineItemId: "", // No PO line for this SKU
              skuId: rl.skuId,
              skuName: item?.name || rl.skuId,
              uom: item?.uom || "Each",
              qtyOrdered: 0,
              qtyAlreadyReceived: 0,
              qtyThisReceipt: rl.qtyReceived,
              variance: rl.qtyReceived,
              receiptLineIds: [rl.id],
            });
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

    // 7. Score and rank POs by SKU overlap with UNMATCHED receipt lines
    const receiptSkuIds = new Set(unmatchedReceiptLines.map((rl) => rl.skuId).filter(Boolean));

    const scoredPOs = matchablePOs.map((po) => {
      const poSkuIds = new Set(po.lineItems.map((li) => li.skuId));
      const overlapping = [...receiptSkuIds].filter((skuId) => poSkuIds.has(skuId!));
      const overlapCount = overlapping.length;
      const overlapSkuNames = overlapping.map((skuId) => itemMap[skuId!]?.name || skuId).filter(Boolean) as string[];
      // Score: PO number match from External Receipt ID = 100, then SKU overlap count
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
        skuNames: po.lineItems.map((li) => itemMap[li.skuId]?.name || li.skuId),
      };
    })
      .filter((po) => po.score > 0) // Only show POs with some relevance
      .sort((a, b) => b.score - a.score);

    // Also include all POs (unscored) in case user needs to pick one without overlap
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
        skuNames: po.lineItems.map((li) => itemMap[li.skuId]?.name || li.skuId),
      }));

    // Best match = highest scored PO (or external match)
    const bestMatch = scoredPOs.length > 0 ? scoredPOs[0] : null;

    // Available items for SKU editing dropdown
    const availableItems = allItems
      .filter((item) => (item.fields["Status"] as string) !== "Inactive")
      .map((item) => ({
        id: item.id,
        standardSku: (item.fields["Standard SKU"] as string) || (item.fields["Name"] as string) || item.id,
      }))
      .sort((a, b) => a.standardSku.localeCompare(b.standardSku));

    return NextResponse.json({
      receipt: {
        id: receipt.id,
        receiptNumber: receipt.fields["Receipt Number"] as string,
        receivedDate: receipt.fields["Received Date"] as string,
        externalReceiptId,
        warehouse: receipt.fields["Warehouses"],
      },
      receiptLines,
      suggestedPO: bestMatch ? { id: bestMatch.id, poNumber: bestMatch.poNumber } : null,
      comparison,
      rankedPOs: scoredPOs,
      otherPOs,
      availableItems,
    });
  } catch (error) {
    console.error("Suggest PO error:", error);
    return NextResponse.json(
      { error: `Failed to suggest PO: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
