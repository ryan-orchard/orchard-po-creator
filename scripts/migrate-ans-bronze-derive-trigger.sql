-- Make orchard.ans_on_order_reports (bronze) the source of truth for the
-- ANS-driven fields on orchard_calcs.po_line_statuses (silver).
--
-- Before: the app ingest wrote silver (expected_ship_date) directly and never
-- populated this bronze table. After: the app inserts raw report rows into
-- bronze, and THIS trigger derives silver from them. Silver becomes a pure
-- projection of bronze.
--
-- Design notes:
--   * Resolution mirrors the app: PO via ('PO-' || customer_po), item via
--     org_config.items.ans_item_number, line via the (po_id, item_id) pair.
--     Unresolvable rows are a no-op (bronze still keeps the raw row).
--   * Latest-report-wins: silver is only overwritten when the incoming bronze
--     row's report_date is >= the report_date currently recorded on silver.
--     This holds even if an older report is backfilled after a newer one.
--   * No status downgrade: a line already 'complete' or 'cancelled' keeps its
--     status; anything else is bumped to 'confirmed' (ANS confirms the line).
--   * Activity logging stays in the app — the trigger only projects data.

set search_path = orchard, orchard_calcs, org_config, public;

-- Idempotent bronze: one row per (client, report, PO, item). Lets the app
-- re-ingest the same file as a no-op (ON CONFLICT DO NOTHING) without dupes.
create unique index if not exists ans_on_order_reports_natural_key
  on orchard.ans_on_order_reports (client_id, report_date, customer_po, ans_item_number);

create or replace function orchard.derive_po_line_status_from_ans()
returns trigger
language plpgsql
security definer
set search_path = orchard, orchard_calcs, org_config, public
as $$
declare
  v_po_id      uuid;
  v_item_id    uuid;
  v_po_line_id uuid;
begin
  -- Resolve PO ('PO-' || customer_po) -> item (ans_item_number) -> po_line.
  select id into v_po_id
    from orchard.purchase_orders
    where po_number = 'PO-' || new.customer_po
    limit 1;
  if v_po_id is null then return new; end if;

  select id into v_item_id
    from org_config.items
    where ans_item_number = new.ans_item_number
    limit 1;
  if v_item_id is null then return new; end if;

  select id into v_po_line_id
    from orchard.po_lines
    where po_id = v_po_id and item_id = v_item_id
    limit 1;
  if v_po_line_id is null then return new; end if;

  -- Project bronze -> silver. Insert if absent, else update under the
  -- latest-report-wins guard in the WHERE clause.
  insert into orchard_calcs.po_line_statuses
    (po_line_id, status, expected_ship_date, expected_receive_date,
     source_report_date, notes, updated_at, updated_by)
  values
    (v_po_line_id, 'confirmed', new.est_ship_date, new.customer_req_date,
     new.report_date, new.notes, now(), 'ANS On Order Report ' || new.report_date)
  on conflict (po_line_id) do update set
    expected_ship_date   = excluded.expected_ship_date,
    expected_receive_date = excluded.expected_receive_date,
    source_report_date   = excluded.source_report_date,
    notes                = excluded.notes,
    status = case
               when orchard_calcs.po_line_statuses.status in ('complete', 'cancelled')
                 then orchard_calcs.po_line_statuses.status
               else 'confirmed'
             end,
    updated_at = now(),
    updated_by = excluded.updated_by
  where orchard_calcs.po_line_statuses.source_report_date is null
     or excluded.source_report_date >= orchard_calcs.po_line_statuses.source_report_date;

  return new;
end;
$$;

drop trigger if exists trg_ans_bronze_derive_silver on orchard.ans_on_order_reports;

create trigger trg_ans_bronze_derive_silver
  after insert on orchard.ans_on_order_reports
  for each row
  execute function orchard.derive_po_line_status_from_ans();
