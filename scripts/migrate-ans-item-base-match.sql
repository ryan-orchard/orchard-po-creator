-- ANS On Order trigger: tolerate item-code suffix changes, keep drafts as drafts.
--
-- The 10/20/26 report ("MAGNA_OOR_10.20.26.xlsx") lists items as F4283S-1,
-- F4337S-1-10L, ... while org_config.items carries codes like F4283S-11L.
-- The exact ans_item_number match silently dropped those rows. Now:
--   * Resolve the line among the PO's own lines: exact ans_item_number first,
--     else the base code (orchard.ans_item_base strips "-<n>L" and a trailing
--     "-1"), so F4064S-1-11L / F4064S-11L / F4064S-1 all match, but F4064S-28
--     stays distinct. Restricting to the PO's lines keeps the fallback safe.
--   * Draft lines keep 'draft' (dates still update); only other non-final
--     statuses are bumped to 'confirmed'. complete/cancelled unchanged.
-- Supersedes the function body in migrate-ans-bronze-derive-trigger.sql.
-- Mirrors ansItemBase() in src/lib/ans-on-order-ingest.ts.

set search_path = orchard, orchard_calcs, org_config, public;

create or replace function orchard.ans_item_base(code text)
returns text
language sql
immutable
as $$
  select regexp_replace(regexp_replace(upper(btrim(code)), '-\d+L$', ''), '-1$', '')
$$;

create or replace function orchard.derive_po_line_status_from_ans()
returns trigger
language plpgsql
security definer
set search_path = orchard, orchard_calcs, org_config, public
as $$
declare
  v_po_id      uuid;
  v_po_line_id uuid;
begin
  select id into v_po_id
    from orchard.purchase_orders
    where po_number = 'PO-' || new.customer_po
    limit 1;
  if v_po_id is null then return new; end if;

  select pl.id into v_po_line_id
    from orchard.po_lines pl
    join org_config.items i on i.id = pl.item_id
    where pl.po_id = v_po_id
      and orchard.ans_item_base(i.ans_item_number) = orchard.ans_item_base(new.ans_item_number)
    order by (i.ans_item_number = new.ans_item_number) desc
    limit 1;
  if v_po_line_id is null then return new; end if;

  insert into orchard_calcs.po_line_statuses
    (po_line_id, status, expected_ship_date, expected_receive_date,
     source_report_date, notes, updated_at, updated_by)
  values
    (v_po_line_id, 'confirmed', new.est_ship_date, new.customer_req_date,
     new.report_date, new.notes, now(), 'ANS On Order Report ' || new.report_date)
  on conflict (po_line_id) do update set
    expected_ship_date    = excluded.expected_ship_date,
    expected_receive_date = excluded.expected_receive_date,
    source_report_date    = excluded.source_report_date,
    notes                 = excluded.notes,
    status = case
               when orchard_calcs.po_line_statuses.status in ('complete', 'cancelled', 'draft')
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
