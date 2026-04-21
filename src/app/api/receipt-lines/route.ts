import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";

/**
 * GET /api/receipt-lines
 *
 * Returns all receipt lines joined with receipt headers, items, and locations.
 * Query params: status (optional) — filter by Unmatched, Matched, Excluded
 */
export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status");

    // Fetch all tables in parallel
    const [linesRes, receiptsRes, itemsRes, locationsRes, posRes] =
      await Promise.all([
        db.schema("orchard").from("receipt_lines").select("*"),
        db.schema("orchard").from("receipts").select("*"),
        db.schema("org_config").from("items").select("id, sku"),
        db.schema("org_config").from("locations").select("id, code"),
        db.schema("orchard").from("purchase_orders").select("id, po_number"),
      ]);

    if (linesRes.error) throw linesRes.error;
    if (receiptsRes.error) throw receiptsRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (locationsRes.error) throw locationsRes.error;
    if (posRes.error) throw posRes.error;

    // Build lookup maps
    const receiptsById = new Map(
      receiptsRes.data.map((r) => [r.id, r])
    );
    const itemsById = new Map(
      itemsRes.data.map((i) => [i.id, i])
    );
    const locationsById = new Map(
      locationsRes.data.map((l) => [l.id, l])
    );
    const posById = new Map(
      posRes.data.map((p) => [p.id, p])
    );

    // Count all statuses before filtering
    const counts = { unmatched: 0, matched: 0, excluded: 0 };
    for (const line of linesRes.data) {
      const s = (line.status || "Unmatched").toLowerCase();
      if (s in counts) counts[s as keyof typeof counts]++;
    }

    // Filter by status if requested
    let filtered = linesRes.data;
    if (status) {
      filtered = filtered.filter(
        (l) => (l.status || "Unmatched").toLowerCase() === status.toLowerCase()
      );
    }

    // Join and shape
    const lines = filtered.map((line) => {
      const receipt = receiptsById.get(line.receipt_id);
      const item = line.item_id ? itemsById.get(line.item_id) : null;
      const location = receipt?.location_id
        ? locationsById.get(receipt.location_id)
        : null;
      const po = receipt?.po_id ? posById.get(receipt.po_id) : null;

      return {
        id: line.id,
        receiptId: line.receipt_id,
        date: receipt?.received_date ?? null,
        warehouse: location?.code ?? null,
        item: item?.sku ?? line.three_pl_sku ?? "Unknown",
        itemId: line.item_id ?? null,
        threePlSku: line.three_pl_sku ?? null,
        qty: line.qty_received,
        orderRef: receipt?.external_id ?? null,
        poNumber: po?.po_number ?? null,
        stordReceiptId: receipt?.stord_receipt_id ?? null,
        status: line.status || "Unmatched",
      };
    });

    // Sort by date descending (nulls last)
    lines.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    });

    return NextResponse.json({ lines, counts });
  } catch (error) {
    return NextResponse.json(
      {
        error: `Failed to fetch receipt lines: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
