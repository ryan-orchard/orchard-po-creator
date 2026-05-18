-- ============================================================
-- Migration 012: Seed data for the movements layer
-- ============================================================
-- Loads:
--   1. Missing locations (GlobalTranz, Justman, Logic, With Intent, Customer)
--   2. org_config.location_roles — one row per (location, role) pair
--   3. Unique constraint on paths for safe re-runs
--   4. org_config.paths — catalog from Ryan's Inventory Paths sketch
--   5. Backfill org_config.items.accounting_category for existing rows
--
-- All inserts are idempotent — safe to re-run.
-- ============================================================

-- =============================================================================
-- 1. Add missing locations
-- =============================================================================
-- Existing: AMZN, ANS, BMC, RJW, STORD
-- Adding:   GLOBALTRANZ (carrier), JUSTMAN, LOGIC, WITHINTENT (suppliers),
--           CUSTOMER (virtual sink for fulfillments)

INSERT INTO org_config.locations (code, name)
SELECT v.code, v.name
FROM (VALUES
  ('GLOBALTRANZ', 'GlobalTranz'),
  ('JUSTMAN',     'Justman'),
  ('LOGIC',       'Logic'),
  ('WITHINTENT',  'With Intent'),
  ('CUSTOMER',    'Customer (virtual)')
) AS v(code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM org_config.locations l WHERE l.code = v.code
);

-- =============================================================================
-- 2. Seed location_roles
-- =============================================================================
-- ANS plays four roles (supplier, warehouse, kitting, transportation).
-- Stord and BMC play two each (warehouse + kitting).
-- Everyone else plays one role.

INSERT INTO org_config.location_roles (location_id, role)
SELECT l.id, r.role
FROM (VALUES
  ('ANS',         'supplier'),
  ('ANS',         'warehouse'),
  ('ANS',         'kitting'),
  ('ANS',         'transportation'),
  ('STORD',       'warehouse'),
  ('STORD',       'kitting'),
  ('BMC',         'warehouse'),
  ('BMC',         'kitting'),
  ('RJW',         'warehouse'),
  ('AMZN',        'warehouse'),
  ('GLOBALTRANZ', 'transportation'),
  ('JUSTMAN',     'supplier'),
  ('LOGIC',       'supplier'),
  ('WITHINTENT',  'supplier'),
  ('CUSTOMER',    'customer')
) AS r(code, role)
JOIN org_config.locations l ON l.code = r.code
ON CONFLICT (location_id, role) DO NOTHING;

-- =============================================================================
-- 3. Unique constraint on paths (so seed is idempotent)
-- =============================================================================
-- NULLS NOT DISTINCT treats NULL carrier values as equal, so we don't get
-- duplicate paths when carrier is unknown.

ALTER TABLE org_config.paths
  DROP CONSTRAINT IF EXISTS paths_unique_tuple;

ALTER TABLE org_config.paths
  ADD CONSTRAINT paths_unique_tuple
  UNIQUE NULLS NOT DISTINCT
  (type, from_location_id, to_location_id, item_category, carrier);

-- =============================================================================
-- 4. Seed paths catalog (16 paths from Ryan's Inventory Paths sketch)
-- =============================================================================
-- Category mapping from the sketch to accounting_category:
--   Sticks            → Components
--   Product Packaging → Components
--   Components        → Components
--   FG                → FG
--   Packaging         → Packaging

INSERT INTO org_config.paths (
  type, from_location_id, to_location_id, item_category, carrier, notes
)
SELECT
  p.type, f.id, t.id, p.item_category, p.carrier, p.notes
FROM (VALUES
  -- Acquisitions (title transfers to Magna)
  ('Acquisition', 'ANS',        'ANS',      'Components', 'Bill & Hold',      'Sticks billed but held at ANS'),
  ('Acquisition', 'ANS',        'BMC',      'Components', 'GlobalTranz',      'Sticks to BMC for kitting'),
  ('Acquisition', 'ANS',        'STORD',    'FG',         'GlobalTranz',      'FG to Stord'),
  ('Acquisition', 'ANS',        'AMZN',     'FG',         'GlobalTranz',      'FG to Amazon FBA'),
  ('Acquisition', 'LOGIC',      'ANS',      'Components', 'GlobalTranz',      'Empty cartons to ANS'),
  ('Acquisition', 'LOGIC',      'BMC',      'Components', 'GlobalTranz',      'Empty cartons to BMC'),
  ('Acquisition', 'WITHINTENT', 'STORD',    'FG',         'Supplier Freight', 'Water bottles to Stord'),
  ('Acquisition', 'JUSTMAN',    'STORD',    'Packaging',  NULL,               'Shipping packaging to Stord'),

  -- Movements (between owned locations)
  ('Movement',    'ANS',        'BMC',      'Components', 'GlobalTranz',      NULL),
  ('Movement',    'ANS',        'STORD',    'FG',         'GlobalTranz',      NULL),
  ('Movement',    'ANS',        'AMZN',     'FG',         'GlobalTranz',      NULL),
  ('Movement',    'STORD',      'AMZN',     'FG',         NULL,               NULL),
  ('Movement',    'BMC',        'RJW',      'FG',         NULL,               NULL),

  -- Fulfillments (leaving the owned network)
  ('Fulfillment', 'STORD',      'CUSTOMER', 'FG',         'Stord Parcel',     NULL),
  ('Fulfillment', 'AMZN',       'CUSTOMER', 'FG',         'Amazon Parcel',    NULL),
  ('Fulfillment', 'RJW',        'CUSTOMER', 'FG',         NULL,               NULL)
) AS p(type, from_code, to_code, item_category, carrier, notes)
JOIN org_config.locations f ON f.code = p.from_code
JOIN org_config.locations t ON t.code = p.to_code
ON CONFLICT ON CONSTRAINT paths_unique_tuple DO NOTHING;

-- =============================================================================
-- 5. Backfill items.accounting_category for existing rows
-- =============================================================================
-- Rules (order matters — CASE is short-circuit):
--   1. PKG-MASTERCASE, PKG-WAFERSEAL → Packaging (true shipping materials)
--   2. All other PKG-*               → Components (empty cartons consumed in kitting)
--   3. Any *-STICK                   → Components
--   4. ELEC-*, CREA-*, MERCH-*       → FG (consumer packs + merch)
--   5. Everything else               → NULL (flag for manual review)

UPDATE org_config.items
SET accounting_category = CASE
  WHEN sku IN ('PKG-MASTERCASE','PKG-WAFERSEAL')                THEN 'Packaging'
  WHEN sku LIKE 'PKG-%'                                          THEN 'Components'
  WHEN sku LIKE '%-STICK'                                        THEN 'Components'
  WHEN sku LIKE 'ELEC-%' OR sku LIKE 'CREA-%' OR sku LIKE 'MERCH-%' THEN 'FG'
  ELSE NULL
END
WHERE accounting_category IS NULL;
