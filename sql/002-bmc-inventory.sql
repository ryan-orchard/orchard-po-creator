-- BMC Inventory Ingestion: inventory snapshots + transaction tables
-- Run this in the Supabase SQL Editor

-- =============================================================================
-- 1. Inventory Snapshots table (replaces Airtable tblXFUhjdVW7uGtK1)
-- =============================================================================
CREATE TABLE IF NOT EXISTS orchard.inventory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL DEFAULT 'magna',
  warehouse_code TEXT NOT NULL,            -- 'BMC', 'ANS', etc.
  snapshot_date DATE NOT NULL,
  item_id UUID REFERENCES org_config.items(id),
  sku TEXT NOT NULL,                        -- standard SKU (denormalized for convenience)
  qty_on_hand NUMERIC NOT NULL DEFAULT 0,
  qty_on_hold NUMERIC NOT NULL DEFAULT 0,
  qty_available NUMERIC NOT NULL DEFAULT 0,
  base_uom TEXT,                           -- 'CASE' or 'EACH'
  pallet_count NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_snapshot_item UNIQUE (warehouse_code, snapshot_date, item_id)
);

CREATE INDEX idx_snapshots_warehouse_date ON orchard.inventory_snapshots(warehouse_code, snapshot_date);
CREATE INDEX idx_snapshots_client ON orchard.inventory_snapshots(client_id);

-- =============================================================================
-- 2. BMC Transactions table (production data from daily report)
-- =============================================================================
CREATE TABLE IF NOT EXISTS orchard.bmc_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL DEFAULT 'magna',
  posting_date DATE NOT NULL,
  item_id UUID REFERENCES org_config.items(id),
  bmc_item_no TEXT NOT NULL,               -- e.g. 'SINLML0101', 'MAGTLM1001'
  description TEXT,
  quantity NUMERIC NOT NULL,               -- positive = in, negative = out
  base_quantity NUMERIC,
  entry_type TEXT NOT NULL,                -- Purchase, Consumption, Output, Sale, Positive Adjmt., Negative Adjmt.
  uom TEXT,                                -- EACH or CASE
  external_doc_no TEXT,                    -- PO reference or kitting PO
  lot_no TEXT,
  document_no TEXT,                        -- BMC internal doc number
  prod_order_no TEXT,                      -- links consumption ↔ output
  order_no TEXT,
  reason_code TEXT,
  reason_desc TEXT,                        -- e.g. 'Vendor Shortage/Overage', 'Production Scrap'
  entry_no BIGINT NOT NULL,                -- BMC unique identifier — idempotency key
  expiration_date DATE,
  production_date DATE,
  report_date DATE,                        -- date of the email/report
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_bmc_entry_no UNIQUE (entry_no)
);

CREATE INDEX idx_bmc_txn_posting_date ON orchard.bmc_transactions(posting_date);
CREATE INDEX idx_bmc_txn_entry_type ON orchard.bmc_transactions(entry_type);
CREATE INDEX idx_bmc_txn_item ON orchard.bmc_transactions(bmc_item_no);
CREATE INDEX idx_bmc_txn_client ON orchard.bmc_transactions(client_id);
CREATE INDEX idx_bmc_txn_report_date ON orchard.bmc_transactions(report_date);

-- =============================================================================
-- 3. Insert 5 new case SKUs (ELEC-*-60)
-- =============================================================================
INSERT INTO org_config.items (sku, name, unit_of_measure, sticks_per_carton, description, is_active, metadata)
VALUES
  ('ELEC-APPLEJUICE-60', 'Apple Juice Case (6×10ct)', 'Case', NULL, 'BMC finished good — 6 × 10ct cartons = 60 sticks', TRUE,
   '{"category": "Electrolytes", "flavor": "Apple Juice", "bmcItemNo": "MAGAJU1001"}'::jsonb),
  ('ELEC-BLOODORANGE-60', 'Blood Orange Case (6×10ct)', 'Case', NULL, 'BMC finished good — 6 × 10ct cartons = 60 sticks', TRUE,
   '{"category": "Electrolytes", "flavor": "Blood Orange", "bmcItemNo": "MAGBLO1001"}'::jsonb),
  ('ELEC-LEMONLIME-60', 'Lemon Lime Case (6×10ct)', 'Case', NULL, 'BMC finished good — 6 × 10ct cartons = 60 sticks', TRUE,
   '{"category": "Electrolytes", "flavor": "Lemon Lime", "bmcItemNo": "MAGLML1001"}'::jsonb),
  ('ELEC-TEALEMONADE-60', 'Tea Lemonade Case (6×10ct)', 'Case', NULL, 'BMC finished good — 6 × 10ct cartons = 60 sticks', TRUE,
   '{"category": "Electrolytes", "flavor": "Tea Lemonade", "bmcItemNo": "MAGTLM1001"}'::jsonb),
  ('ELEC-WATERMELONLIME-60', 'Watermelon Lime Case (6×10ct)', 'Case', NULL, 'BMC finished good — 6 × 10ct cartons = 60 sticks', TRUE,
   '{"category": "Electrolytes", "flavor": "Watermelon Lime", "bmcItemNo": "MAGWML1001"}'::jsonb)
ON CONFLICT (sku) DO NOTHING;
