/**
 * ANS On Order Report ingestion.
 *
 * Bronze-first: this function writes raw report rows into the bronze table
 * orchard.ans_on_order_reports. An AFTER INSERT trigger
 * (orchard.derive_po_line_status_from_ans, see
 * scripts/migrate-ans-bronze-derive-trigger.sql) derives silver —
 * orchard_calcs.po_line_statuses.expected_ship_date et al. This function does
 * NOT write silver directly; silver is a pure projection of bronze.
 *
 * Steps:
 *   1. Resolve each row to a PO line via ('PO-' || customer_po) + ans_item_number
 *      (for activity logging only; the trigger resolves independently for the write).
 *   2. Snapshot the existing silver rows BEFORE the bronze insert.
 *   3. Emit activity-log entries for meaningful changes vs that snapshot (status
 *      transition, expected ship date shift, customer req ship date shift, new
 *      confirmation). Notes changes are skipped — they rewrite every week.
 *   4. Upsert every parsed row into bronze (idempotent on the natural key); the
 *      trigger projects them into silver.
 */
import { db } from "./supabase";
import { logActivity } from "./activity-log";
import type { AnsOnOrderReportResult, AnsOnOrderRow } from "./ans-on-order-parser";

// ANS On Order reports come from Magna's co-packer; Magna is the only client
// on this feed today. Hardcoded until a second client needs it.
const CLIENT_ID = "magna";

export interface AnsOnOrderIngestResult {
  reportDate: string;
  matchedLines: number;
  unmatchedRows: { customerPo: string; ansItemNumber: string; reason: string }[];
  activityEvents: number;
}

interface ResolvedRow {
  parsed: AnsOnOrderRow;
  poLineId: string;
  poId: string;
}

interface ExistingStatus {
  status: string | null;
  expected_ship_date: string | null;
  expected_receive_date: string | null;
  notes: string | null;
}

const DATE_FMT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "numeric",
  day: "numeric",
  year: "2-digit",
  timeZone: "UTC",
};

function fmtDate(d: string | null): string {
  if (!d) return "TBD";
  // d is YYYY-MM-DD; render as M/D/YY for log readability
  const [y, m, day] = d.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", DATE_FMT_OPTIONS);
}

export async function processAnsOnOrderReport(
  report: AnsOnOrderReportResult
): Promise<AnsOnOrderIngestResult> {
  const unmatched: AnsOnOrderIngestResult["unmatchedRows"] = [];

  if (report.rows.length === 0) {
    return {
      reportDate: report.reportDate,
      matchedLines: 0,
      unmatchedRows: unmatched,
      activityEvents: 0,
    };
  }

  // ── Resolve every (customer_po, ans_item_number) pair to a po_line_id ───
  const poNumbers = [...new Set(report.rows.map((r) => `PO-${r.customerPo}`))];
  const ansItemNumbers = [...new Set(report.rows.map((r) => r.ansItemNumber))];

  const [poResp, itemResp] = await Promise.all([
    db
      .schema("orchard")
      .from("purchase_orders")
      .select("id, po_number")
      .in("po_number", poNumbers),
    db
      .schema("org_config")
      .from("items")
      .select("id, ans_item_number")
      .in("ans_item_number", ansItemNumbers),
  ]);

  if (poResp.error) throw new Error(`Failed to resolve POs: ${poResp.error.message}`);
  if (itemResp.error) throw new Error(`Failed to resolve items: ${itemResp.error.message}`);

  const poIdByNumber = new Map((poResp.data ?? []).map((p) => [p.po_number as string, p.id as string]));
  const itemIdByAns = new Map(
    (itemResp.data ?? []).map((i) => [i.ans_item_number as string, i.id as string])
  );

  const poIds = [...new Set([...poIdByNumber.values()])];
  const itemIds = [...new Set([...itemIdByAns.values()])];

  let poLinesResp: { data: { id: string; po_id: string; item_id: string }[] | null; error: Error | null } = {
    data: [],
    error: null,
  };
  if (poIds.length > 0 && itemIds.length > 0) {
    const r = await db
      .schema("orchard")
      .from("po_lines")
      .select("id, po_id, item_id")
      .in("po_id", poIds)
      .in("item_id", itemIds);
    poLinesResp = { data: r.data as { id: string; po_id: string; item_id: string }[] | null, error: r.error as Error | null };
  }

  if (poLinesResp.error) throw new Error(`Failed to load po_lines: ${poLinesResp.error.message}`);

  // Key: `${po_id}::${item_id}` → { id, po_id }
  const poLineByPair = new Map<string, { id: string; poId: string }>();
  for (const pl of poLinesResp.data ?? []) {
    poLineByPair.set(`${pl.po_id}::${pl.item_id}`, { id: pl.id, poId: pl.po_id });
  }

  const resolved: ResolvedRow[] = [];
  for (const row of report.rows) {
    const poId = poIdByNumber.get(`PO-${row.customerPo}`);
    const itemId = itemIdByAns.get(row.ansItemNumber);
    if (!poId) {
      unmatched.push({
        customerPo: row.customerPo,
        ansItemNumber: row.ansItemNumber,
        reason: "PO not found in purchase_orders",
      });
      continue;
    }
    if (!itemId) {
      unmatched.push({
        customerPo: row.customerPo,
        ansItemNumber: row.ansItemNumber,
        reason: "ANS item number not mapped in org_config.items.ans_item_number",
      });
      continue;
    }
    const pl = poLineByPair.get(`${poId}::${itemId}`);
    if (!pl) {
      unmatched.push({
        customerPo: row.customerPo,
        ansItemNumber: row.ansItemNumber,
        reason: "PO line not found for this item on this PO",
      });
      continue;
    }
    resolved.push({ parsed: row, poLineId: pl.id, poId: pl.poId });
  }

  // Note: even if nothing resolves, we still write bronze below — resolution is
  // only needed for activity logging. The diff/log block no-ops on empty input.

  // ── Load existing statuses for the resolved po_line_ids ────────────────
  const poLineIds = resolved.map((r) => r.poLineId);
  const { data: existingRows, error: existingErr } = await db
    .schema("orchard_calcs")
    .from("po_line_statuses")
    .select("po_line_id, status, expected_ship_date, expected_receive_date, notes")
    .in("po_line_id", poLineIds);

  if (existingErr) throw new Error(`Failed to load existing statuses: ${existingErr.message}`);

  const existingByLine = new Map<string, ExistingStatus>(
    (existingRows ?? []).map((r) => [
      r.po_line_id as string,
      {
        status: (r.status as string | null) ?? null,
        expected_ship_date: (r.expected_ship_date as string | null) ?? null,
        expected_receive_date: (r.expected_receive_date as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
      },
    ])
  );

  // ── Diff and log ────────────────────────────────────────────────────────
  const reportTag = `ANS On Order Report (${fmtDate(report.reportDate)})`;
  let activityEvents = 0;

  for (const r of resolved) {
    const prior = existingByLine.get(r.poLineId);
    const itemTag = `${r.parsed.ansItemNumber} on PO-${r.parsed.customerPo}`;
    const dispositionSuffix = r.parsed.disposition ? ` [${r.parsed.disposition}]` : "";

    if (!prior) {
      logActivity({
        poId: r.poId,
        action: "ans_line_confirmed",
        description:
          `${reportTag}: confirmed ${itemTag} ` +
          `(est ship ${fmtDate(r.parsed.estShipReadyDate)}, ` +
          `customer req ${fmtDate(r.parsed.customerReqShipDate)})${dispositionSuffix}`,
        actor: "Orchard AI",
      });
      activityEvents += 1;
    } else {
      // State transition
      if (prior.status && prior.status !== "confirmed" && prior.status !== "in_transit" && prior.status !== "received") {
        // Going from ordered/draft → confirmed is a real signal; from confirmed → confirmed is not
        if (prior.status !== "confirmed") {
          logActivity({
            poId: r.poId,
            action: "ans_line_status_change",
            description: `${reportTag}: ${itemTag} status ${prior.status} → confirmed${dispositionSuffix}`,
            actor: "Orchard AI",
          });
          activityEvents += 1;
        }
      }
      // Expected ship date revision — the headline signal Ryan cares about
      if (prior.expected_ship_date !== r.parsed.estShipReadyDate) {
        const newStr = fmtDate(r.parsed.estShipReadyDate);
        const oldStr = fmtDate(prior.expected_ship_date);
        logActivity({
          poId: r.poId,
          action: "ans_expected_ship_changed",
          description: `${reportTag}: ${itemTag} — Expected Ship date revised to ${newStr} (was ${oldStr})${dispositionSuffix}`,
          actor: "Orchard AI",
        });
        activityEvents += 1;
      }
      // Customer req ship date revision (rarer)
      if (prior.expected_receive_date !== r.parsed.customerReqShipDate) {
        const newStr = fmtDate(r.parsed.customerReqShipDate);
        const oldStr = fmtDate(prior.expected_receive_date);
        logActivity({
          poId: r.poId,
          action: "ans_req_ship_changed",
          description: `${reportTag}: ${itemTag} — Customer Req Ship date revised to ${newStr} (was ${oldStr})`,
          actor: "Orchard AI",
        });
        activityEvents += 1;
      }
    }
  }

  // ── Write bronze; the trigger derives silver ───────────────────────────
  // Every parsed row is preserved in bronze, even rows we couldn't resolve to a
  // PO line above — resolution is a silver concern handled by the trigger, which
  // no-ops on rows it can't match. Idempotent on the natural key so re-ingesting
  // the same file is a no-op rather than a duplicate.
  const receivedAt = new Date().toISOString();
  const bronzeRows = report.rows.map((row) => ({
    client_id: CLIENT_ID,
    report_date: report.reportDate,
    report_received_at: receivedAt,
    source_filename: report.sourceFilename,
    customer_po: row.customerPo,
    ans_item_number: row.ansItemNumber,
    est_ship_date: row.estShipReadyDate,
    customer_req_date: row.customerReqShipDate,
    qty_ordered: row.salesQty,
    qty_cancelled: null,
    notes: row.notes,
    raw_payload: row,
  }));

  const batchSize = 100;
  for (let i = 0; i < bronzeRows.length; i += batchSize) {
    const batch = bronzeRows.slice(i, i + batchSize);
    const { error: bErr } = await db
      .schema("orchard")
      .from("ans_on_order_reports")
      .upsert(batch, {
        onConflict: "client_id,report_date,customer_po,ans_item_number",
        ignoreDuplicates: true,
      });
    if (bErr) throw new Error(`Failed to write bronze ans_on_order_reports: ${bErr.message}`);
  }

  console.log(
    `ANS On Order ingest (${report.reportDate}): ${resolved.length} matched / ` +
      `${unmatched.length} unmatched / ${activityEvents} activity events`
  );

  return {
    reportDate: report.reportDate,
    matchedLines: resolved.length,
    unmatchedRows: unmatched,
    activityEvents,
  };
}
