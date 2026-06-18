import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { SKU_MAPPING } from "@/lib/client-config";
import { attemptPOMatch } from "@/lib/po-matching";
import { rollUpPoStatus } from "@/lib/po-status";

/**
 * GET /api/receipts/[id]/suggest-po
 *
 * Returns receipt details, a suggested PO match, and comparison data
 * for the matching UI. Accepts ?poId=xxx to compare a specific PO.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: receiptId } = await params;
    const { searchParams } = new URL(request.url);
    const specificPoId = searchParams.get("poId");

    // Fetch receipt
    const { data: receipt } = await db
      .schema("orchard")
      .from("receipts")
      .select("id, receipt_number, received_date, external_id, location_id, po_id")
      .eq("id", receiptId)
      .maybeSingle();

    if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

    // Fetch receipt lines
    const { data: receiptLinesRaw } = await db
      .schema("orchard")
      .from("receipt_lines")
      .select("id, item_id, qty_received, three_pl_sku, lot_number")
      .eq("receipt_id", receiptId);

    // All POs are matchable candidates — SKU-overlap scoring ranks them below.
    const { data: allPoRows } = await db
      .schema("orchard")
      .from("purchase_orders")
      .select("id");

    const matchablePoIds = (allPoRows ?? []).map((r) => r.id as string);

    const { data: posRaw } = matchablePoIds.length > 0
      ? await db.schema("orchard").from("purchase_orders").select("id, po_number").in("id", matchablePoIds)
      : { data: [] };

    // Fetch all po_lines for matchable POs
    const { data: poLinesRaw } = matchablePoIds.length > 0
      ? await db.schema("orchard").from("po_lines").select("id, po_id, item_id, qty").in("po_id", matchablePoIds)
      : { data: [] };

    // Roll each PO's status up from its line statuses.
    const { data: poLineStatusRows } = (poLinesRaw ?? []).length > 0
      ? await db
          .schema("orchard_calcs")
          .from("po_line_statuses")
          .select("po_line_id, status")
          .in("po_line_id", (poLinesRaw ?? []).map((pl) => pl.id as string))
      : { data: [] };
    const lineStateById = new Map(
      (poLineStatusRows ?? []).map((s) => [s.po_line_id as string, s.status as string])
    );
    const poStatusMap = new Map<string, string>();
    for (const pid of matchablePoIds) {
      const states = (poLinesRaw ?? [])
        .filter((pl) => pl.po_id === pid)
        .map((pl) => lineStateById.get(pl.id as string) ?? "ordered");
      poStatusMap.set(pid, rollUpPoStatus(states));
    }

    // Fetch all items referenced
    const allItemIds = [
      ...new Set([
        ...(receiptLinesRaw ?? []).map((rl) => rl.item_id as string).filter(Boolean),
        ...(poLinesRaw ?? []).map((pl) => pl.item_id as string).filter(Boolean),
      ]),
    ];
    const { data: itemsData } = allItemIds.length > 0
      ? await db.schema("org_config").from("items").select("id, sku, uom").in("id", allItemIds)
      : { data: [] };

    const itemMap = new Map(
      (itemsData ?? []).map((i) => [i.id as string, { sku: i.sku as string, uom: i.uom as string }])
    );

    // Build standardSku → item lookup (for 3PL SKU resolution)
    const skuNameToItemId = new Map((itemsData ?? []).map((i) => [i.sku as string, i.id as string]));

    // Get all PO line IDs to check existing receipt coverage
    const allPoLineIds = (poLinesRaw ?? []).map((pl) => pl.id as string);
    const { data: existingLinks } = allPoLineIds.length > 0
      ? await db
          .schema("orchard_calcs")
          .from("po_line_receipt_line_links")
          .select("po_line_id, receipt_line_id")
          .in("po_line_id", allPoLineIds)
      : { data: [] };

    // Get receipt_lines for those links (to sum qty by po_line)
    const linkedReceiptLineIds = (existingLinks ?? []).map((l) => l.receipt_line_id as string);
    const { data: linkedReceiptLines } = linkedReceiptLineIds.length > 0
      ? await db
          .schema("orchard")
          .from("receipt_lines")
          .select("id, receipt_id, qty_received")
          .in("id", linkedReceiptLineIds)
      : { data: [] };

    // Get which receipt_lines belong to THIS receipt (to exclude from "already received")
    const thisReceiptLineIds = new Set(
      (receiptLinesRaw ?? []).map((rl) => rl.id as string)
    );

    // Sum already-received qty per po_line (from OTHER receipts, not the current one)
    const alreadyReceivedByPoLine = new Map<string, number>();
    for (const link of existingLinks ?? []) {
      const rl = (linkedReceiptLines ?? []).find((r) => r.id === link.receipt_line_id);
      if (!rl || thisReceiptLineIds.has(rl.id as string)) continue;
      const qty = Number(rl.qty_received) || 0;
      alreadyReceivedByPoLine.set(
        link.po_line_id as string,
        (alreadyReceivedByPoLine.get(link.po_line_id as string) || 0) + qty
      );
    }

    // Which of THIS receipt's lines are already matched to a PO?
    const matchedReceiptLineIds = new Set(
      (existingLinks ?? [])
        .map((l) => l.receipt_line_id as string)
        .filter((id) => thisReceiptLineIds.has(id))
    );

    // Build receipt lines with resolved SKU
    const receiptLines = (receiptLinesRaw ?? []).map((rl) => {
      let itemId = rl.item_id as string | null;
      const threePlSku = (rl.three_pl_sku as string) || null;

      if (!itemId && threePlSku) {
        const mapping = SKU_MAPPING[threePlSku];
        if (mapping?.standardSku) itemId = skuNameToItemId.get(mapping.standardSku) ?? null;
      }

      const item = itemId ? itemMap.get(itemId) : null;
      return {
        id: rl.id as string,
        skuId: itemId,
        skuName: item?.sku ?? null,
        uom: item?.uom ?? null,
        qtyReceived: Number(rl.qty_received) || 0,
        threePlSku,
        lotNumber: (rl.lot_number as string) || null,
        matched: matchedReceiptLineIds.has(rl.id as string),
      };
    });

    const unmatchedReceiptLines = receiptLines.filter((rl) => !rl.matched);

    // PO candidates list
    const poMap = new Map((posRaw ?? []).map((po) => [po.id as string, po.po_number as string]));
    type POLineRow = { id: unknown; po_id: unknown; item_id: unknown; qty: unknown };
    const poLinesByPO = new Map<string, POLineRow[]>();
    for (const pl of poLinesRaw ?? []) {
      const key = pl.po_id as string;
      if (!poLinesByPO.has(key)) poLinesByPO.set(key, []);
      poLinesByPO.get(key)!.push(pl as POLineRow);
    }

    const matchablePOs = (posRaw ?? []).map((po) => ({
      id: po.id as string,
      poNumber: po.po_number as string,
      status: poStatusMap.get(po.id as string) ?? "",
      lineItems: (poLinesByPO.get(po.id as string) ?? []).map((pl) => ({
        id: pl.id as string,
        skuId: pl.item_id as string,
        qty: Number(pl.qty) || 0,
      })),
    }));

    // Auto-suggest from receipt external_id
    const externalReceiptId = (receipt.external_id as string) || "";
    const suggestedMatch = attemptPOMatch(
      externalReceiptId,
      matchablePOs.map((po) => ({ id: po.id, poNumber: po.poNumber }))
    );

    // Build comparison for the suggested or specified PO
    const comparisonPoId = specificPoId || suggestedMatch?.id;
    let comparison = null;

    if (comparisonPoId) {
      const po = matchablePOs.find((p) => p.id === comparisonPoId);
      if (po) {
        const receiptQtyBySku = new Map<string, number>();
        const receiptLineIdBySku = new Map<string, string[]>();
        for (const rl of unmatchedReceiptLines) {
          if (rl.skuId) {
            receiptQtyBySku.set(rl.skuId, (receiptQtyBySku.get(rl.skuId) || 0) + rl.qtyReceived);
            const existing = receiptLineIdBySku.get(rl.skuId) || [];
            receiptLineIdBySku.set(rl.skuId, [...existing, rl.id]);
          }
        }

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
          const item = itemMap.get(poLine.skuId);
          const uom = item?.uom || "Each";
          const qtyOrdered = poLine.qty;
          const qtyAlreadyReceived = alreadyReceivedByPoLine.get(poLine.id) || 0;
          const qtyThisReceipt = receiptQtyBySku.get(poLine.skuId) || 0;
          const remaining = qtyOrdered - qtyAlreadyReceived;
          const variance = qtyThisReceipt - remaining;

          const line: ComparisonLine = {
            poLineItemId: poLine.id,
            skuId: poLine.skuId,
            skuName: item?.sku || poLine.skuId,
            uom,
            qtyOrdered,
            qtyAlreadyReceived,
            qtyThisReceipt,
            variance,
            receiptLineIds: receiptLineIdBySku.get(poLine.skuId) || [],
          };

          if (qtyThisReceipt > 0) {
            matchedLines.push(line);
          } else {
            otherLines.push(line);
          }
          processedSkuIds.add(poLine.skuId);
        }

        // Receipt lines for SKUs NOT on this PO
        for (const rl of unmatchedReceiptLines) {
          if (rl.skuId && !processedSkuIds.has(rl.skuId)) {
            const item = itemMap.get(rl.skuId);
            matchedLines.push({
              poLineItemId: "",
              skuId: rl.skuId,
              skuName: item?.sku || rl.skuId,
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

    // Score and rank POs by SKU overlap with unmatched receipt lines
    const receiptSkuIds = new Set(unmatchedReceiptLines.map((rl) => rl.skuId).filter(Boolean) as string[]);

    const scoredPOs = matchablePOs
      .map((po) => {
        const poSkuIds = new Set(po.lineItems.map((li) => li.skuId));
        const overlapping = [...receiptSkuIds].filter((skuId) => poSkuIds.has(skuId));
        const overlapSkuNames = overlapping.map((skuId) => itemMap.get(skuId)?.sku || skuId);
        const isExternalMatch = suggestedMatch?.id === po.id;
        const score = (isExternalMatch ? 100 : 0) + overlapping.length;

        return {
          id: po.id,
          poNumber: po.poNumber,
          status: po.status,
          skuCount: po.lineItems.length,
          overlapCount: overlapping.length,
          overlapSkuNames,
          score,
          skuNames: po.lineItems.map((li) => itemMap.get(li.skuId)?.sku || li.skuId),
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
        skuNames: po.lineItems.map((li) => itemMap.get(li.skuId)?.sku || li.skuId),
      }));

    const bestMatch = scoredPOs.length > 0 ? scoredPOs[0] : null;

    // Available items for SKU editing
    const { data: allItems } = await db
      .schema("org_config")
      .from("items")
      .select("id, sku")
      .eq("is_active", true)
      .order("sku");

    const availableItems = (allItems ?? []).map((i) => ({
      id: i.id as string,
      standardSku: i.sku as string,
    }));

    return NextResponse.json({
      receipt: {
        id: receipt.id,
        receiptNumber: receipt.receipt_number,
        receivedDate: receipt.received_date,
        externalReceiptId,
        warehouse: receipt.location_id,
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
