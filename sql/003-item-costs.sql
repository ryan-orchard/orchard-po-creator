-- Item Costs table — stores unit cost per item for inventory valuation
-- Manual upload for now, auto-calculated (weighted average) later
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS orchard.item_costs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID NOT NULL REFERENCES org_config.items(id),
  unit_cost      NUMERIC NOT NULL,
  effective_date DATE NOT NULL,
  source         TEXT NOT NULL DEFAULT 'manual',  -- 'manual' | 'calculated'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_item_cost UNIQUE (item_id, effective_date)
);

CREATE INDEX idx_item_costs_item ON orchard.item_costs(item_id);
CREATE INDEX idx_item_costs_date ON orchard.item_costs(effective_date);

-- =============================================================================
-- Seed BMC item costs (effective 2026-04-01, source: manual)
-- =============================================================================
INSERT INTO orchard.item_costs (item_id, unit_cost, effective_date, source)
SELECT id, cost, '2026-04-01'::date, 'manual'
FROM (VALUES
  -- Sticks (raw materials at BMC)
  ('ELEC-APPLEJUICE-STICK',     0.31),
  ('ELEC-BLOODORANGE-STICK',    0.35),
  ('ELEC-LEMONLIME-STICK',      0.27),
  ('ELEC-TEALEMONADE-STICK',    0.27),
  ('ELEC-WATERMELONLIME-STICK', 0.30),
  -- 10ct Cartons (packaging)
  ('PKG-APPLEJUICE-10',         0.25),
  ('PKG-BLOODORANGE-10',        0.25),
  ('PKG-LEMONLIME-10',          0.26),
  ('PKG-TEALEMONADE-10',        0.28),
  ('PKG-WATERMELONLIME-10',     0.26),
  -- Packaging materials
  ('PKG-WAFERSEAL',             0.00),
  ('PKG-MASTERCASE',            0.55),
  -- Cases (finished goods — 6 × 10ct)
  ('ELEC-APPLEJUICE-60',       23.75),
  ('ELEC-BLOODORANGE-60',      27.55),
  ('ELEC-LEMONLIME-60',        22.06),
  ('ELEC-TEALEMONADE-60',      21.95),
  ('ELEC-WATERMELONLIME-60',   23.62)
) AS v(sku, cost)
JOIN org_config.items i ON i.sku = v.sku
ON CONFLICT (item_id, effective_date) DO UPDATE SET unit_cost = EXCLUDED.unit_cost;
