-- ============================================================
-- Migration 016: Add missing Raspberry Tea stick item
-- ============================================================
-- The ANS On Order Report (2026-05-06) references F4334S-1-11L
-- (Magna Hydration Raspberry Tea 1ct), which had no mapping in
-- org_config.items. Add the SKU and map it.
--
-- The 28-count version (F4334S-28-11L → ELEC-RASPBERRYTEA-28)
-- already exists.
--
-- After running this, re-run migration 015 to pick up the previously
-- unmatched line.
-- ============================================================

INSERT INTO org_config.items (
  sku, name, unit_of_measure, description, is_active,
  category, accounting_category, ans_item_number
)
VALUES (
  'ELEC-RASPBERRYTEA-STICK',
  'Electrolyte Raspberry Tea Stick',
  'Stick',
  'Raspberry Tea — single stick (raw component)',
  TRUE,
  'Electrolyte',
  'Components',
  'F4334S-1-11L'
)
ON CONFLICT (sku) DO UPDATE
  SET ans_item_number = COALESCE(org_config.items.ans_item_number, EXCLUDED.ans_item_number);
