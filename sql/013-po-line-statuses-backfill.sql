-- ============================================================
-- Migration 013: Backfill po_line_statuses from PO header status
-- ============================================================
-- One-time seed to populate orchard.po_line_statuses with a sensible
-- starting state for every existing PO line, derived from the header
-- status. The ANS weekly On Order Report will overwrite these with
-- more accurate line-level data once that pipeline is wired up.
--
-- Idempotent — uses ON CONFLICT DO NOTHING so re-runs are safe and
-- won't overwrite any line states that have been updated by hand or
-- by the report.
-- ============================================================

INSERT INTO orchard.po_line_statuses (po_line_id, state, source_report_date, notes)
SELECT
  pl.id,
  CASE ps.status
    WHEN 'Draft'              THEN 'ordered'
    WHEN 'Issued'             THEN 'ordered'
    WHEN 'Accepted'           THEN 'confirmed'
    WHEN 'Shipped'            THEN 'in_transit'
    WHEN 'Partially Received' THEN 'in_transit'
    WHEN 'Received'           THEN 'received'
    WHEN 'Closed'             THEN 'received'
    WHEN 'Cancelled'          THEN 'cancelled'
    ELSE 'ordered'
  END AS state,
  NULL::date AS source_report_date,
  'Backfilled from PO header status (' || COALESCE(ps.status, 'none') || ')' AS notes
FROM orchard.po_lines pl
LEFT JOIN orchard_calcs.po_statuses ps ON ps.po_id = pl.po_id
ON CONFLICT (po_line_id) DO NOTHING;
