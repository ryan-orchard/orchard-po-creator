-- ============================================================
-- Migration 010: Repoint link table FKs from Bronze → Silver receipt_lines
-- ============================================================
-- The match link tables in orchard_calcs reference receipt_line_id with FKs
-- that originally pointed at orchard.receipt_lines (Bronze). After Migration 009,
-- the unified Silver table orchard_calcs.receipt_lines is the source of truth —
-- BMC lines exist only there. Inserts into the link tables fail for BMC line
-- ids because they're not in Bronze.
--
-- Since Stord lines are copied into Silver verbatim (same UUID), repointing
-- the FK doesn't invalidate any existing rows.
-- ============================================================

-- 1. receipt_line_invoice_line_links: receipt_line_id → Silver
ALTER TABLE orchard_calcs.receipt_line_invoice_line_links
  DROP CONSTRAINT IF EXISTS receipt_line_invoice_line_links_receipt_line_id_fkey;

ALTER TABLE orchard_calcs.receipt_line_invoice_line_links
  ADD CONSTRAINT receipt_line_invoice_line_links_receipt_line_id_fkey
  FOREIGN KEY (receipt_line_id)
  REFERENCES orchard_calcs.receipt_lines(id)
  ON DELETE CASCADE;

-- 2. po_line_receipt_line_links: receipt_line_id → Silver
ALTER TABLE orchard_calcs.po_line_receipt_line_links
  DROP CONSTRAINT IF EXISTS po_line_receipt_line_links_receipt_line_id_fkey;

ALTER TABLE orchard_calcs.po_line_receipt_line_links
  ADD CONSTRAINT po_line_receipt_line_links_receipt_line_id_fkey
  FOREIGN KEY (receipt_line_id)
  REFERENCES orchard_calcs.receipt_lines(id)
  ON DELETE CASCADE;
