-- ============================================================
-- Migration 018: Broader "ANS PO line not in report = shipped"
-- ============================================================
-- 017 only flipped lines from POs that appeared in the ANS report
-- (e.g. PO-33, PO-34, PO-10001, PO-10006, PO-10007, PO-10008).
--
-- This goes further: ANY ANS PO line that is not in the latest report
-- gets flipped to in_transit. Older ANS POs whose lines have moved
-- past production but are still 'ordered' or 'confirmed' in our system
-- are inferred shipped.
--
-- ANS is identified by supplier (not by PO number pattern), so this
-- only touches POs whose supplier is ANS — non-ANS POs (Justman, Logic,
-- With Intent, etc.) are untouched.
--
-- Safety: only updates lines currently in 'ordered' or 'confirmed'.
-- Anything already 'received', 'invoiced', 'costed', 'paid' is preserved.
-- ============================================================

WITH ans_supplier AS (
  SELECT id
  FROM org_config.suppliers
  WHERE UPPER(code) = 'ANS'
     OR name ILIKE '%Arizona Nutritional%'
     OR name ILIKE 'ANS%'
  LIMIT 1
),
ans_pos AS (
  SELECT id AS po_id
  FROM orchard.purchase_orders
  WHERE supplier_id = (SELECT id FROM ans_supplier)
),
in_report AS (
  SELECT po_line_id
  FROM orchard.po_line_statuses
  WHERE source_report_date = '2026-05-06'::date
)
UPDATE orchard.po_line_statuses ls
SET state            = 'in_transit',
    actual_ship_date = '2026-05-06'::date,
    notes            = COALESCE(ls.notes, '') || ' | Inferred shipped — ANS PO not on report 2026-05-06',
    updated_by       = 'ANS On Order Report 2026-05-06 (inferred shipped, broad rule)',
    updated_at       = NOW()
FROM orchard.po_lines pl
WHERE ls.po_line_id = pl.id
  AND pl.po_id IN (SELECT po_id FROM ans_pos)
  AND ls.po_line_id NOT IN (SELECT po_line_id FROM in_report)
  AND ls.state IN ('ordered','confirmed');

-- Verification: confirm we found the ANS supplier
SELECT id, code, name FROM org_config.suppliers
WHERE UPPER(code) = 'ANS'
   OR name ILIKE '%Arizona Nutritional%'
   OR name ILIKE 'ANS%';
