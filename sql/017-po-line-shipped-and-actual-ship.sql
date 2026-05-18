-- ============================================================
-- Migration 017: Add actual_ship_date + flip "missing from ANS report" lines to in_transit
-- ============================================================
-- 1. Adds orchard.po_line_statuses.actual_ship_date.
-- 2. For every PO that appears in the ANS On Order Report (i.e. ANS is
--    actively working on it), lines from that PO that did NOT appear in
--    the report are inferred as shipped — flip them to in_transit and
--    stamp actual_ship_date = report date.
--    Only applies to lines currently in 'ordered' or 'confirmed' state
--    so we don't backslide any already-received / costed / paid lines.
--
-- Depends on migration 015 having already run successfully.
-- ============================================================

-- 1. New column
ALTER TABLE orchard.po_line_statuses
  ADD COLUMN IF NOT EXISTS actual_ship_date DATE;

-- 2. Flip shipped lines
-- The ANS report was 2026-05-06. POs that appear in it: PO-33, PO-34,
-- PO-10001, PO-10006, PO-10007, PO-10008.
WITH ans_pos AS (
  SELECT DISTINCT po.id AS po_id
  FROM orchard.purchase_orders po
  WHERE po.po_number IN ('PO-33','PO-34','PO-10001','PO-10006','PO-10007','PO-10008')
),
in_report AS (
  -- po_line_ids that ARE on the report (most-recent source_report_date)
  SELECT po_line_id
  FROM orchard.po_line_statuses
  WHERE source_report_date = '2026-05-06'::date
)
UPDATE orchard.po_line_statuses ls
SET state            = 'in_transit',
    actual_ship_date = '2026-05-06'::date,
    notes            = COALESCE(ls.notes, '') || ' | Inferred shipped — not on ANS report 2026-05-06',
    updated_by       = 'ANS On Order Report 2026-05-06 (inferred shipped)',
    updated_at       = NOW()
FROM orchard.po_lines pl
WHERE ls.po_line_id = pl.id
  AND pl.po_id IN (SELECT po_id FROM ans_pos)
  AND ls.po_line_id NOT IN (SELECT po_line_id FROM in_report)
  AND ls.state IN ('ordered','confirmed');
