-- ============================================================
-- Migration 014: Backfill expected_ship_date and expected_receive_date
-- from PO header delivery_date
-- ============================================================
-- Run AFTER 013 (which creates the po_line_statuses rows). This UPDATE
-- only touches rows where expected_ship_date is still NULL, so it
-- won't overwrite real dates loaded later from the ANS On Order Report.
--
-- Both columns get set to the same value because the PO header only
-- has one date (delivery_date). The ANS report will refine these into
-- proper ship vs. receive dates.
--
-- Idempotent — re-running has no effect once dates are populated.
-- ============================================================

UPDATE orchard.po_line_statuses ls
SET
  expected_ship_date    = po.delivery_date,
  expected_receive_date = po.delivery_date,
  notes                 = COALESCE(ls.notes, '') || ' | Dates from PO header delivery_date'
FROM orchard.po_lines pl
JOIN orchard.purchase_orders po ON po.id = pl.po_id
WHERE ls.po_line_id = pl.id
  AND po.delivery_date IS NOT NULL
  AND ls.expected_ship_date IS NULL;
