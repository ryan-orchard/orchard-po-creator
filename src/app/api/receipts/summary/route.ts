import { NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import crypto from "crypto";

function syntheticReceiptId(source: string, sourceDocNo: string | null, fallback: string): string {
  const key = `hdr:${source}:${sourceDocNo ?? fallback}`;
  const h = crypto.createHash("sha1").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * GET /api/receipts/summary
 *
 * Returns receipts grouped from silver (orchard_calcs.receipt_lines), with
 * per-receipt line counts by invoice status. Covers both Stord and BMC.
 */
export async function GET() {
  try {
    const [silverLinesRes, statusesRes] = await Promise.all([
      db.schema("orchard_calcs").from("receipt_lines")
        .select("id, source, source_doc_no, received_date, warehouse_code"),
      db.schema("orchard_calcs").from("receipt_line_statuses")
        .select("receipt_line_id, invoice_status, flag"),
    ]);

    if (silverLinesRes.error) throw silverLinesRes.error;

    const lines = silverLinesRes.data ?? [];
    const statusByLineId = new Map(
      (statusesRes.data ?? []).map(s => [s.receipt_line_id as string, s])
    );

    // For Stord: find bronze receipt ID via external_id = source_doc_no.
    // (Looking up by silver line ID in bronze receipt_lines is incorrect — they have different ID spaces.)
    const stordDocNos = [...new Set(
      lines
        .filter(l => l.source === "stord" && l.source_doc_no)
        .map(l => l.source_doc_no as string)
    )];
    const bronzeReceiptByDocNo = new Map<string, string>();
    if (stordDocNos.length > 0) {
      const { data: bronzeReceipts } = await db.schema("orchard")
        .from("receipts")
        .select("id, external_id")
        .in("external_id", stordDocNos);
      for (const r of bronzeReceipts ?? []) {
        bronzeReceiptByDocNo.set(r.external_id as string, r.id as string);
      }
    }

    // Group silver lines into receipt buckets
    type ReceiptGroup = {
      receiptId: string;
      source: string;
      date: string | null;
      warehouse: string | null;
      orderRef: string | null;
      lineIds: string[];
    };

    const groups = new Map<string, ReceiptGroup>();

    for (const line of lines) {
      const source = (line.source as string) ?? "unknown";
      const sourceDocNo = (line.source_doc_no as string) ?? null;
      const bronzeId = source === "stord" && sourceDocNo
        ? bronzeReceiptByDocNo.get(sourceDocNo)
        : null;
      const receiptId = bronzeId ?? syntheticReceiptId(source, sourceDocNo, line.id as string);

      if (!groups.has(receiptId)) {
        groups.set(receiptId, {
          receiptId,
          source,
          date: (line.received_date as string) ?? null,
          warehouse: (line.warehouse_code as string) ?? null,
          orderRef: sourceDocNo,
          lineIds: [],
        });
      }
      groups.get(receiptId)!.lineIds.push(line.id as string);
    }

    const receipts = [...groups.values()].map(group => {
      let unmatchedCount = 0;
      let matchedCount = 0;
      let excludedCount = 0;

      for (const id of group.lineIds) {
        const s = statusByLineId.get(id);
        if (s?.flag === "excluded") excludedCount++;
        else if (s?.invoice_status === "matched") matchedCount++;
        else unmatchedCount++;
      }

      return {
        receiptId: group.receiptId,
        source: group.source,
        date: group.date,
        warehouse: group.warehouse,
        orderRef: group.orderRef,
        totalLines: group.lineIds.length,
        unmatchedCount,
        matchedCount,
        excludedCount,
      };
    });

    receipts.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

    const counts = {
      unmatched: receipts.filter(r => r.unmatchedCount > 0).length,
      matched: receipts.filter(r => r.unmatchedCount === 0 && r.excludedCount === 0 && r.matchedCount > 0).length,
      excluded: receipts.filter(r => r.excludedCount > 0 && r.unmatchedCount === 0).length,
    };

    return NextResponse.json({ receipts, counts });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch receipt summary: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    );
  }
}
