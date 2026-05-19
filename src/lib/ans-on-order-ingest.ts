/**
 * ANS On Order Report ingestion.
 *
 * For each parsed row:
 *   1. Resolve to a PO line via ('PO-' || customer_po) + ans_item_number.
 *   2. Diff against the existing orchard.po_line_statuses row.
 *   3. Emit activity-log entries for meaningful changes (state transition,
 *      expected ship date shift, customer req ship date shift, new confirmation).
 *      Notes changes are skipped — they rewrite every week and would be noise.
 *   4. Upsert into orchard.po_line_statuses with state='confirmed'.
 *
 * Raw report rows live in ingested_documents.parsed_data so we never need
 * a separate bronze table for audit / history.
 */
import { db } from "./supabase";
import { logActivity } from "./activity-log";
import type { AnsOnOrderReportResult, AnsOnOrderRow } from "./ans-on-order-parser";

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
  state: string | null;
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
  if (!d) return "—";
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

  if (resolved.length === 0) {
    return {
      reportDate: report.reportDate,
      matchedLines: 0,
      unmatchedRows: unmatched,
      activityEvents: 0,
    };
  }

  // ── Load existing statuses for the resolved po_line_ids ────────────────
  const poLineIds = resolved.map((r) => r.poLineId);
  const { data: existingRows, error: existingErr } = await db
    .schema("orchard")
    .from("po_line_statuses")
    .select("po_line_id, state, expected_ship_date, expected_receive_date, notes")
    .in("po_line_id", poLineIds);

  if (existingErr) throw new Error(`Failed to load existing statuses: ${existingErr.message}`);

  const existingByLine = new Map<string, ExistingStatus>(
    (existingRows ?? []).map((r) => [
      r.po_line_id as string,
      {
        state: (r.state as string | null) ?? null,
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
      if (prior.state && prior.state !== "confirmed" && prior.state !== "in_transit" && prior.state !== "received") {
        // Going from ordered/draft → confirmed is a real signal; from confirmed → confirmed is not
        if (prior.state !== "confirmed") {
          logActivity({
            poId: r.poId,
            action: "ans_line_state_change",
            description: `${reportTag}: ${itemTag} state ${prior.state} → confirmed${dispositionSuffix}`,
            actor: "Orchard AI",
          });
          activityEvents += 1;
        }
      }
      // Expected ship date shift — the headline signal Ryan cares about
      if (prior.expected_ship_date !== r.parsed.estShipReadyDate) {
        const from = fmtDate(prior.expected_ship_date);
        const to = fmtDate(r.parsed.estShipReadyDate);
        const direction =
          prior.expected_ship_date && r.parsed.estShipReadyDate && r.parsed.estShipReadyDate > prior.expected_ship_date
            ? "pushed"
            : prior.expected_ship_date && r.parsed.estShipReadyDate && r.parsed.estShipReadyDate < prior.expected_ship_date
            ? "pulled in"
            : "updated";
        logActivity({
          poId: r.poId,
          action: "ans_expected_ship_changed",
          description: `${reportTag}: ${itemTag} expected ship ${direction} ${from} → ${to}${dispositionSuffix}`,
          actor: "Orchard AI",
        });
        activityEvents += 1;
      }
      // Customer req ship date change (rarer)
      if (prior.expected_receive_date !== r.parsed.customerReqShipDate) {
        const from = fmtDate(prior.expected_receive_date);
        const to = fmtDate(r.parsed.customerReqShipDate);
        logActivity({
          poId: r.poId,
          action: "ans_req_ship_changed",
          description: `${reportTag}: ${itemTag} customer req ship ${from} → ${to}`,
          actor: "Orchard AI",
        });
        activityEvents += 1;
      }
    }
  }

  // ── Upsert po_line_statuses ────────────────────────────────────────────
  const upsertRows = resolved.map((r) => ({
    po_line_id: r.poLineId,
    state: "confirmed",
    expected_ship_date: r.parsed.estShipReadyDate,
    expected_receive_date: r.parsed.customerReqShipDate,
    source_report_date: report.reportDate,
    notes: r.parsed.notes,
    updated_by: `ANS On Order Report ${report.reportDate}`,
    updated_at: new Date().toISOString(),
  }));

  // Batch upsert
  const batchSize = 100;
  for (let i = 0; i < upsertRows.length; i += batchSize) {
    const batch = upsertRows.slice(i, i + batchSize);
    const { error: upErr } = await db
      .schema("orchard")
      .from("po_line_statuses")
      .upsert(batch, { onConflict: "po_line_id" });
    if (upErr) throw new Error(`Failed to upsert po_line_statuses: ${upErr.message}`);
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
