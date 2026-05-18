-- ============================================================
-- Migration 015: ANS On Order Report import (2026-05-06)
-- ============================================================
-- Source file: OpenSalesOrdersSummary- MAGNA5.6.26.xlsx
-- Report date: 2026-05-06
--
-- Updates po_line_statuses for all lines that appear in the ANS report.
-- Match keys:
--   'PO-' || Customer PO (col H) → orchard.purchase_orders.po_number
--   ITEMID (col C)               → org_config.items.ans_item_number
--
-- Any line in the report → state = 'confirmed' (ANS has acknowledged it).
-- Est Ship Ready → expected_ship_date (if a real date; else NULL).
-- Customer Req. Ship Date → expected_receive_date.
-- Notes column carries forward to po_line_statuses.notes.
--
-- Unmatched rows are logged via the verification query at the bottom.
-- ============================================================

-- Stage the report data
CREATE TEMP TABLE ans_on_order_import (
  customer_po        TEXT,
  ans_item_number    TEXT,
  est_ship_date      DATE,
  customer_req_date  DATE,
  notes              TEXT
);

INSERT INTO ans_on_order_import (customer_po, ans_item_number, est_ship_date, customer_req_date, notes) VALUES
  ('34', 'FK4355S-14', NULL, '2026-05-15'::date, 'Est Ship Ready: TBD | Bulk Start: NA | Dependant on sticks completing Consumer Box: TBD'),
  ('34', 'F4335S-14-10L', '2026-06-16'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-25 | Film Due 5/26/26 Consumer Box: TBD'),
  ('34', 'F4336S-14-10L', '2026-06-23'::date, '2026-05-15'::date, 'Bulk Start: 2026-06-01 | R6856 Nat Raspberry R6857 Nat Raspberry Due 6/2/26 Film Due 5/26/26 Consumer Box TBD'),
  ('34', 'F4337S-14-10L', '2026-06-16'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-25 | Film Due 5/26/26 Consumer Box TBD'),
  ('34', 'F4335S-1-10L', '2026-06-16'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-25 | Film Due 5/26/26'),
  ('34', 'F4336S-1-10L', '2026-06-16'::date, '2026-05-15'::date, 'Bulk Start: 2026-06-01 | Film Due 5/26/26'),
  ('34', 'F4337S-1-10L', '2026-06-16'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-25 | Film Due 5/26/26'),
  ('33', 'F4064S-28-11L', '2026-05-15'::date, '2026-05-15'::date, 'Bulk Start: Bulk RAF''d | Production: Kitting'),
  ('33', 'F4066S-28-11L', '2026-05-15'::date, '2026-05-15'::date, 'Bulk Start: Bulk RAF''d | Production: Kitting'),
  ('33', 'F4110S-28-11L', '2026-05-25'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-04 | Production: Dispensing'),
  ('33', 'F4157S-28-11L', '2026-05-25'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-04 | Production: Set Up'),
  ('33', 'F4227S-28-11L', '2026-06-01'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-11 | Production: Scheduled'),
  ('33', 'F4273S-28-11L', '2026-06-01'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-11 | Production: Scheduled'),
  ('33', 'F4283S-28-11L', '2026-05-25'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-04 | Production: Set Up'),
  ('33', 'FK4230S-28', '2026-05-11'::date, '2026-05-15'::date, 'Bulk Start: Kit 5/8/26 | Dependant on sticks completing'),
  ('33', 'F4334S-28-11L', '2026-06-23'::date, '2026-05-15'::date, 'Bulk Start: 2026-06-01 | R6856 Nat Raspberry R6857 Nat Raspberry Due 6/2/26'),
  ('33', 'F4157S-1-11L', '2026-05-25'::date, '2026-05-15'::date, 'Bulk Start: 2026-05-04 | Production: Set Up'),
  ('10008', 'F4335S-1-10L', NULL, '2026-07-22'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-26 | All Raws look as planned'),
  ('10008', 'F4336S-1-10L', NULL, '2026-07-22'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | Watching- R715 Mag ACC Due 6/26 R6857 Nat Rasp 6/23/26'),
  ('10008', 'F4337S-1-10L', NULL, '2026-07-22'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10007', 'F4335S-14-10L', NULL, '2026-07-22'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-26 | All RAWS look as planned'),
  ('10007', 'F4336S-14-10L', NULL, '2026-07-22'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | Watching- R715 Mag ACC Due 6/26 R6857 Nat Rasp 6/23/26'),
  ('10007', 'F4337S-14-10L', NULL, '2026-07-22'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10007', 'FK4355S-14', NULL, '2026-07-22'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | ~Dependant on Sticks~'),
  ('10006', 'F4283S-1-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10006', 'F4227S-1-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10006', 'F4273S-1-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10006', 'F4334S-1-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26 R6857 Nat Rasp 6/23/26'),
  ('10006', 'F4125S-1-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | R6610 Nat Apple Due 6/9/26 - Watching- R715 Mag ACC Due 6/26/26'),
  ('10006', 'F4157S-1-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10006', 'F4064S-1-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10001', 'F4227S-28-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10001', 'F4157S-28-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10001', 'F4125S-28-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | R6610 Nat Apple Due 6/9/26 - Watching- R715 Mag ACC Due 6/26/26'),
  ('10001', 'F4283S-28-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10001', 'F4273S-28-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26/26'),
  ('10001', 'F4334S-28-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-07-06 | Watching- R715 Mag ACC Due 6/26 R6857 Nat Rasp 6/23/26'),
  ('10001', 'F4064S-28-11L', NULL, '2026-07-28'::date, 'Est Ship Ready: TBD | Bulk Start: 2026-06-29 | Watching- R715 Mag ACC Due 6/26/26');

-- Upsert into po_line_statuses
INSERT INTO orchard.po_line_statuses (
  po_line_id, state, expected_ship_date, expected_receive_date,
  source_report_date, notes, updated_by
)
SELECT
  pl.id,
  'confirmed',
  imp.est_ship_date,
  imp.customer_req_date,
  '2026-05-06'::date,
  imp.notes,
  'ANS On Order Report 2026-05-06'
FROM ans_on_order_import imp
JOIN orchard.purchase_orders po ON po.po_number = 'PO-' || imp.customer_po
JOIN org_config.items it       ON it.ans_item_number = imp.ans_item_number
JOIN orchard.po_lines pl       ON pl.po_id = po.id AND pl.item_id = it.id
ON CONFLICT (po_line_id) DO UPDATE SET
  state                 = EXCLUDED.state,
  expected_ship_date    = EXCLUDED.expected_ship_date,
  expected_receive_date = EXCLUDED.expected_receive_date,
  source_report_date    = EXCLUDED.source_report_date,
  notes                 = EXCLUDED.notes,
  updated_by            = EXCLUDED.updated_by,
  updated_at            = NOW();

-- Verification: show any report rows that did NOT match a PO line
SELECT imp.customer_po, imp.ans_item_number, imp.notes
FROM ans_on_order_import imp
LEFT JOIN orchard.purchase_orders po ON po.po_number = 'PO-' || imp.customer_po
LEFT JOIN org_config.items it       ON it.ans_item_number = imp.ans_item_number
LEFT JOIN orchard.po_lines pl       ON pl.po_id = po.id AND pl.item_id = it.id
WHERE pl.id IS NULL
ORDER BY imp.customer_po, imp.ans_item_number;
