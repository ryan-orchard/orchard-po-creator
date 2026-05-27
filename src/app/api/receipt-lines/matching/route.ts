import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { SKU_MAPPING } from "@/lib/client-config";
import { attemptPOMatch } from "@/lib/po-matching";
import { rollUpPoStatus } from "@/lib/po-status";

/**
 * GET /api/receipt-lines/matching
 *
 * Returns all receipt lines with their match status, PO/WO options,
 * and auto-suggested matches.
 */
export async function GET() {
  try {
    // Fetch all base data in parallel
    const [
      receiptLinesResult,
      receiptsResult,
      poLineStatusesResult,
      woResult,
      itemsResult,
      suppliersResult,
      warehousesResult,
    ] = await Promise.all([
      db.schema("orchard").from("receipt_lines").select("id, receipt_id, item_id, qty_received, three_pl_sku, lot_number"),
      db.schema("orchard").from("receipts").select("id, receipt_number, received_date, external_id, location_id, po_id"),
      db.schema("orchard_calcs").from("po_line_statuses").select("po_line_id, state"),
      db.schema("orchard").from("work_orders").select("id, wo_number, status, notes"),
      db.schema("org_config").from("items").select("id, sku, unit_of_measure"),
      db.schema("org_config").from("suppliers").select("id, name"),
      db.schema("org_config").from("locations").select("id, code, name"),
    ]);

    const allReceiptLines = receiptLinesResult.data ?? [];

    // Status now lives in Silver — load and join by receipt_line_id
    const { data: silverStatuses } = await db
      .schema("orchard_calcs")
      .from("receipt_line_statuses")
      .select("receipt_line_id, status");
    const statusByLineId = new Map((silverStatuses ?? []).map((s) => [s.receipt_line_id as string, s.status as string]));
    const allReceipts = receiptsResult.data ?? [];
    const allWOs = woResult.data ?? [];
    const allItems = itemsResult.data ?? [];

    // Build lookups
    const itemMap = new Map(
      allItems.map((i) => [i.id as string, { sku: i.sku as string, uom: i.unit_of_measure as string }])
    );
    const skuNameToItemId = new Map(allItems.map((i) => [i.sku as string, i.id as string]));
    const supplierMap = new Map((suppliersResult.data ?? []).map((s) => [s.id as string, s.name as string]));
    const warehouseMap = new Map(
      (warehousesResult.data ?? []).map((w) => [w.id as string, (w.code as string) || (w.name as string)])
    );

    // Receipt lookup
    const receiptMap = new Map(
      allReceipts.map((r) => {
        const externalId = (r.external_id as string) || "";
        const orderNumber = externalId;
        return [
          r.id as string,
          {
            receiptNumber: (r.receipt_number as string) || "",
            receivedDate: (r.received_date as string) || "",
            orderNumber,
            poReference: "",
            warehouse: r.location_id ? (warehouseMap.get(r.location_id as string) ?? null) : null,
            poId: (r.po_id as string) || null,
          },
        ];
      })
    );

    // All POs are matchable candidates — SKU overlap drives the suggestions.
    const [posResult, poLinesResult] = await Promise.all([
      db.schema("orchard").from("purchase_orders").select("id, po_number, supplier_id, order_date"),
      db.schema("orchard").from("po_lines").select("id, po_id, item_id, qty"),
    ]);

    const allPOs = posResult.data ?? [];
    const allPOLines = poLinesResult.data ?? [];

    // Roll each PO's status up from its line statuses.
    const lineStateById = new Map(
      (poLineStatusesResult.data ?? []).map((s) => [s.po_line_id as string, s.state as string])
    );
    const lineStatesByPo = new Map<string, string[]>();
    for (const pl of allPOLines) {
      const k = pl.po_id as string;
      const arr = lineStatesByPo.get(k) ?? [];
      arr.push(lineStateById.get(pl.id as string) ?? "ordered");
      lineStatesByPo.set(k, arr);
    }
    const poStatusMap = new Map<string, string>(
      allPOs.map((po) => [po.id as string, rollUpPoStatus(lineStatesByPo.get(po.id as string) ?? [])])
    );

    const poMap = new Map(
      allPOs.map((po) => [
        po.id as string,
        {
          poNumber: po.po_number as string,
          status: poStatusMap.get(po.id as string) ?? "",
          date: (po.order_date as string) ?? "",
          supplierId: (po.supplier_id as string) ?? null,
        },
      ])
    );

    const poLinesByPO = new Map<string, typeof allPOLines>();
    for (const pl of allPOLines) {
      const key = pl.po_id as string;
      if (!poLinesByPO.has(key)) poLinesByPO.set(key, []);
      poLinesByPO.get(key)!.push(pl);
    }

    // Fetch ALL po_line_receipt_line_links (not just matchable POs) so we can
    // correctly detect linked status for receipt lines matched to any PO
    const { data: allPoRlLinks } = await db
      .schema("orchard_calcs")
      .from("po_line_receipt_line_links")
      .select("po_line_id, receipt_line_id");

    // We need ALL po_lines (not just matchable) to resolve link → PO ID
    const allPoRlPoLineIds = [...new Set((allPoRlLinks ?? []).map((l) => l.po_line_id as string))];
    const { data: allLinkedPOLines } = allPoRlPoLineIds.length > 0
      ? await db.schema("orchard").from("po_lines").select("id, po_id").in("id", allPoRlPoLineIds)
      : { data: [] };
    const poLineToPoId = new Map(
      (allLinkedPOLines ?? []).map((pl) => [pl.id as string, pl.po_id as string])
    );

    // Which receipt_lines are PO-matched, and what po_line/PO do they link to?
    const receiptLineToPOLink = new Map<string, { poLineId: string; poId: string }>();
    const receivedByPoLine = new Map<string, number>();

    for (const link of allPoRlLinks ?? []) {
      const rlId = link.receipt_line_id as string;
      const plId = link.po_line_id as string;
      const poId = poLineToPoId.get(plId);
      if (poId) receiptLineToPOLink.set(rlId, { poLineId: plId, poId });
    }

    // Fetch PO numbers for all linked POs (including non-matchable ones like Received/Closed)
    const allLinkedPoIds = [...new Set([...receiptLineToPOLink.values()].map((l) => l.poId))];
    const nonMatchablePoIds = allLinkedPoIds.filter((id) => !poMap.has(id));
    const allPoNumberMap = new Map<string, string>();
    if (nonMatchablePoIds.length > 0) {
      const { data: extraPOs } = await db
        .schema("orchard")
        .from("purchase_orders")
        .select("id, po_number")
        .in("id", nonMatchablePoIds);
      for (const po of extraPOs ?? []) {
        allPoNumberMap.set(po.id as string, po.po_number as string);
      }
    }

    // Sum received qty per po_line (for option cards — only matchable POs)
    const matchablePOLineIds = new Set(allPOLines.map((pl) => pl.id as string));
    const matchablePoRlLinks = (allPoRlLinks ?? []).filter((l) => matchablePOLineIds.has(l.po_line_id as string));
    const linkedReceiptLineIds = matchablePoRlLinks.map((l) => l.receipt_line_id as string);
    if (linkedReceiptLineIds.length > 0) {
      const { data: linkedRLs } = await db
        .schema("orchard")
        .from("receipt_lines")
        .select("id, qty_received")
        .in("id", linkedReceiptLineIds);
      const receiptLineQty = new Map(
        (linkedRLs ?? []).map((rl) => [rl.id as string, Number(rl.qty_received) || 0])
      );
      for (const link of matchablePoRlLinks) {
        const qty = receiptLineQty.get(link.receipt_line_id as string) || 0;
        receivedByPoLine.set(
          link.po_line_id as string,
          (receivedByPoLine.get(link.po_line_id as string) || 0) + qty
        );
      }
    }

    // Fetch wo_receipt_links (to know which receipts are WO-linked)
    const { data: woReceiptLinks } = await db
      .schema("orchard_calcs")
      .from("wo_receipt_links")
      .select("wo_id, receipt_id");

    const receiptToWOId = new Map(
      (woReceiptLinks ?? []).map((l) => [l.receipt_id as string, l.wo_id as string])
    );

    // WO output lines (for WO option cards)
    const matchableWOStatuses = new Set(["Completed", "Issued", "In Progress"]);
    const matchableWOIds = allWOs
      .filter((wo) => matchableWOStatuses.has(wo.status as string))
      .map((wo) => wo.id as string);

    const woMap = new Map(
      allWOs.map((wo) => [
        wo.id as string,
        { woNumber: wo.wo_number as string, status: wo.status as string, description: (wo.notes as string) || "" },
      ])
    );

    const { data: woLinesRaw } = matchableWOIds.length > 0
      ? await db
          .schema("orchard")
          .from("work_order_lines")
          .select("id, wo_id, item_id, qty, line_type")
          .in("wo_id", matchableWOIds)
          .eq("line_type", "Output")
      : { data: [] };

    type WOLineRow = { id: unknown; wo_id: unknown; item_id: unknown; qty: unknown; line_type: unknown };
    const woOutputLinesByWO = new Map<string, WOLineRow[]>();
    for (const wl of woLinesRaw ?? []) {
      const key = wl.wo_id as string;
      if (!woOutputLinesByWO.has(key)) woOutputLinesByWO.set(key, []);
      woOutputLinesByWO.get(key)!.push(wl as WOLineRow);
    }

    // PO candidates for auto-suggest
    const matchablePOCandidates = allPOs.map((po) => ({
      id: po.id as string,
      poNumber: po.po_number as string,
    }));

    // --- Process each receipt line ---

    interface POOption {
      poId: string;
      poNumber: string;
      poStatus: string;
      poDate: string;
      supplier: string;
      lineItems: {
        poLineItemId: string;
        sku: string;
        skuId: string;
        section: string;
        qtyOrdered: number;
        qtyReceived: number;
        qtyRemaining: number;
        isMatchable: boolean;
      }[];
    }

    interface WOOption {
      woId: string;
      woNumber: string;
      woStatus: string;
      description: string;
      lineItems: {
        woLineItemId: string;
        sku: string;
        skuId: string;
        qty: number;
        qtyReceived: number;
        qtyRemaining: number;
        isMatchable: boolean;
      }[];
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
      poReference: string;
      receiptNumber: string;
      sourceLineId: string | null;
      warehouse: string | null;
      sku: string;
      skuId: string | null;
      threePlSku: string | null;
      receiptQty: number;
      status: "open" | "linked" | "matched" | "excluded";
      reviewNote: string | null;
      suggestedMatch: SuggestedMatch | null;
      matchedPO: { poId: string; poNumber: string; poLineItemId: string } | null;
      matchedWO: { woId: string; woNumber: string; woLineItemId: string } | null;
      poOptions: POOption[];
      woOptions: WOOption[];
    }

    const lines: MatchingLine[] = [];

    for (const rl of allReceiptLines) {
      const receiptId = rl.receipt_id as string;
      const receipt = receiptMap.get(receiptId);
      if (!receipt) continue;

      const rawItemId = rl.item_id as string | null;
      const threePlSku = (rl.three_pl_sku as string) || null;
      const rlStatus = statusByLineId.get(rl.id as string) ?? "Open";

      // Resolve item_id (fall back to SKU_MAPPING for 3PL SKUs)
      let itemId = rawItemId;
      if (!itemId && threePlSku) {
        const mapping = SKU_MAPPING[threePlSku];
        if (mapping?.standardSku) itemId = skuNameToItemId.get(mapping.standardSku) ?? null;
      }

      const item = itemId ? itemMap.get(itemId) : null;

      // Determine match status
      const isPOMatched = receiptLineToPOLink.has(rl.id as string);
      const isWOLinked = receiptToWOId.has(receiptId);

      let status: "open" | "linked" | "matched" | "excluded";
      if (rlStatus === "Excluded") {
        status = "excluded";
      } else if (rlStatus === "Matched" || isPOMatched || isWOLinked) {
        // "linked" = source matched but not necessarily invoice matched
        // Simplified: treat Matched status as "linked" (full match requires invoice too)
        status = "linked";
      } else {
        status = "open";
      }

      // Build PO and WO options only for open lines with a known SKU
      let suggestedMatch: SuggestedMatch | null = null;
      let poOptions: POOption[] = [];
      let woOptions: WOOption[] = [];

      if (status === "open" && itemId) {
        // PO options — POs that have a line for this SKU
        const relevantPOIds = new Set<string>();
        for (const [poId, poLines] of poLinesByPO) {
          if (poLines.some((pl) => pl.item_id === itemId)) relevantPOIds.add(poId);
        }

        poOptions = [...relevantPOIds]
          .map((poId) => {
            const po = poMap.get(poId)!;
            const poLines = poLinesByPO.get(poId) ?? [];

            return {
              poId,
              poNumber: po.poNumber,
              poStatus: po.status,
              poDate: po.date,
              supplier: po.supplierId ? (supplierMap.get(po.supplierId) ?? "") : "",
              lineItems: poLines.map((pl) => {
                const plItem = itemMap.get(pl.item_id as string);
                const received = receivedByPoLine.get(pl.id as string) || 0;
                const ordered = Number(pl.qty) || 0;
                return {
                  poLineItemId: pl.id as string,
                  sku: plItem?.sku ?? (pl.item_id as string),
                  skuId: pl.item_id as string,
                  section: "",
                  qtyOrdered: ordered,
                  qtyReceived: received,
                  qtyRemaining: ordered - received,
                  isMatchable: pl.item_id === itemId && ordered - received > 0,
                };
              }),
            };
          })
          .sort((a, b) => a.poNumber.localeCompare(b.poNumber, undefined, { numeric: true }));

        // WO options — WOs with output lines for this SKU
        const relevantWOIds = new Set<string>();
        for (const [woId, woLines] of woOutputLinesByWO) {
          if (woLines.some((wl) => wl.item_id === itemId)) relevantWOIds.add(woId);
        }

        woOptions = [...relevantWOIds]
          .map((woId) => {
            const wo = woMap.get(woId)!;
            const woLines = woOutputLinesByWO.get(woId) ?? [];

            return {
              woId,
              woNumber: wo.woNumber,
              woStatus: wo.status,
              description: wo.description,
              lineItems: woLines.map((wl) => {
                const wlItem = itemMap.get(wl.item_id as string);
                const qty = Number(wl.qty) || 0;
                return {
                  woLineItemId: wl.id as string,
                  sku: wlItem?.sku ?? (wl.item_id as string),
                  skuId: wl.item_id as string,
                  qty,
                  qtyReceived: 0, // WO receipts tracked at header level
                  qtyRemaining: qty,
                  isMatchable: wl.item_id === itemId,
                };
              }),
            };
          })
          .sort((a, b) => a.woNumber.localeCompare(b.woNumber, undefined, { numeric: true }));

        // Auto-suggestion: PO Tier 1 — PO number from order number
        const poMatch = attemptPOMatch(receipt.orderNumber, matchablePOCandidates);
        if (poMatch) {
          const matchedPOOpt = poOptions.find((o) => o.poId === poMatch.id);
          const matchableLine = matchedPOOpt?.lineItems.find(
            (li) => li.skuId === itemId && li.qtyRemaining > 0
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

        // PO Tier 2 — exactly one clean PO match (exact SKU + qty, zero prior receipts)
        if (!suggestedMatch) {
          const receiptQty = Number(rl.qty_received) || 0;
          const cleanPOMatches: { sourceId: string; sourceNumber: string; lineItemId: string; qty: number }[] = [];
          for (const poOpt of poOptions) {
            for (const li of poOpt.lineItems) {
              if (li.skuId === itemId && li.qtyOrdered === receiptQty && li.qtyReceived === 0) {
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

        // WO Tier — exactly one clean WO match
        if (!suggestedMatch) {
          const receiptQty = Number(rl.qty_received) || 0;
          const cleanWOMatches: { sourceId: string; sourceNumber: string; lineItemId: string; qty: number }[] = [];
          for (const woOpt of woOptions) {
            for (const li of woOpt.lineItems) {
              if (li.skuId === itemId && li.qty === receiptQty) {
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

      // Resolve matchedPO and matchedWO for display
      let matchedPO: { poId: string; poNumber: string; poLineItemId: string } | null = null;
      if (isPOMatched) {
        const link = receiptLineToPOLink.get(rl.id as string)!;
        const po = poMap.get(link.poId);
        const poNumber = po?.poNumber ?? allPoNumberMap.get(link.poId) ?? link.poId;
        matchedPO = {
          poId: link.poId,
          poNumber,
          poLineItemId: link.poLineId,
        };
      }

      let matchedWO: { woId: string; woNumber: string; woLineItemId: string } | null = null;
      if (isWOLinked) {
        const woId = receiptToWOId.get(receiptId)!;
        const wo = woMap.get(woId);
        matchedWO = {
          woId,
          woNumber: wo?.woNumber ?? woId,
          woLineItemId: "", // WO matching is header-level in Supabase
        };
      }

      lines.push({
        id: rl.id as string,
        receiptId,
        receiptDate: receipt.receivedDate,
        orderNumber: receipt.orderNumber,
        poReference: receipt.poReference,
        receiptNumber: receipt.receiptNumber,
        sourceLineId: null,
        warehouse: receipt.warehouse,
        sku: item?.sku ?? threePlSku ?? "Unknown",
        skuId: itemId,
        threePlSku,
        receiptQty: Number(rl.qty_received) || 0,
        status,
        reviewNote: null,
        suggestedMatch,
        matchedPO,
        matchedWO,
        poOptions,
        woOptions,
      });
    }

    // Sort: open first, then linked, then matched, then excluded; within each, newest date first
    lines.sort((a, b) => {
      const statusOrder = { open: 0, linked: 1, matched: 2, excluded: 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      return (b.receiptDate || "").localeCompare(a.receiptDate || "");
    });

    const counts = {
      open: lines.filter((l) => l.status === "open").length,
      linked: lines.filter((l) => l.status === "linked").length,
      matched: lines.filter((l) => l.status === "matched").length,
      excluded: lines.filter((l) => l.status === "excluded").length,
    };

    return NextResponse.json({ lines, counts });
  } catch (error) {
    console.error("Receipt lines matching error:", error);
    return NextResponse.json(
      { error: `Failed to load matching data: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 }
    );
  }
}
