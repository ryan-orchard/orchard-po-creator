-- ============================================================
-- Migration 009: Silver receipts — unified across Stord + BMC
-- ============================================================
-- Bronze (unchanged):
--   orchard.receipts + orchard.receipt_lines  → Stord (webhook)
--   orchard.bmc_transactions                  → BMC ledger
--
-- Silver (this migration):
--   orchard_calcs.receipt_lines               → 1 row per source line, header denormalized
--   orchard_calcs.receipt_line_statuses       → match status (Open/Matched/Excluded/Review)
--   orchard_calcs.v_receipts                  → header rollup view (what the app reads)
--
-- Sync:
--   Stord  → Postgres trigger on orchard.receipt_lines INSERT
--   BMC    → app code in src/lib/bmc-ingest.ts (separate change)
--
-- For Stord rows, Silver id = Bronze id (verbatim) so existing
-- match links in orchard_calcs.*_links keep resolving without FK updates.
-- BMC rows get fresh UUIDs.
-- ============================================================

-- ─── Silver tables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS orchard_calcs.receipt_lines (
  id              UUID PRIMARY KEY,
  source          TEXT NOT NULL,
  bronze_table    TEXT NOT NULL,
  bronze_id       TEXT NOT NULL,
  -- header (denormalized on every line)
  source_doc_no   TEXT,
  received_date   DATE NOT NULL,
  warehouse_code  TEXT NOT NULL,
  po_id           UUID,
  external_ref    TEXT,
  -- line
  item_id         UUID,
  qty_received   NUMERIC NOT NULL,
  three_pl_sku   TEXT,
  lot_number     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_lines_source_chk CHECK (source IN ('stord','bmc')),
  CONSTRAINT receipt_lines_unique_source_bronze UNIQUE (source, bronze_id)
);

CREATE INDEX IF NOT EXISTS receipt_lines_source_doc_idx
  ON orchard_calcs.receipt_lines (source, source_doc_no);
CREATE INDEX IF NOT EXISTS receipt_lines_warehouse_date_idx
  ON orchard_calcs.receipt_lines (warehouse_code, received_date);
CREATE INDEX IF NOT EXISTS receipt_lines_po_idx
  ON orchard_calcs.receipt_lines (po_id) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS receipt_lines_item_idx
  ON orchard_calcs.receipt_lines (item_id) WHERE item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS orchard_calcs.receipt_line_statuses (
  receipt_line_id UUID PRIMARY KEY
    REFERENCES orchard_calcs.receipt_lines(id) ON DELETE CASCADE,
  status          TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT
);

ALTER TABLE orchard_calcs.receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.receipt_line_statuses ENABLE ROW LEVEL SECURITY;

-- ─── View: receipt headers, rolled up from Silver lines ────────────

CREATE OR REPLACE VIEW orchard_calcs.v_receipts AS
SELECT
  source,
  source_doc_no,
  received_date,
  warehouse_code,
  po_id,
  external_ref,
  COUNT(*)::int     AS line_count,
  SUM(qty_received) AS total_qty,
  MIN(created_at)   AS first_seen
FROM orchard_calcs.receipt_lines
GROUP BY source, source_doc_no, received_date, warehouse_code, po_id, external_ref;

-- ─── Trigger: Stord Bronze → Silver ────────────────────────────────

CREATE OR REPLACE FUNCTION orchard_calcs.sync_stord_receipt_line() RETURNS TRIGGER AS $$
DECLARE
  hdr_external_id   TEXT;
  hdr_received_date DATE;
  hdr_location_id   UUID;
  hdr_po_id         UUID;
  hdr_notes         TEXT;
  whse_code         TEXT;
BEGIN
  SELECT external_id, received_date, location_id, po_id, notes
    INTO hdr_external_id, hdr_received_date, hdr_location_id, hdr_po_id, hdr_notes
  FROM orchard.receipts WHERE id = NEW.receipt_id;

  -- Defensive: if header missing, skip (shouldn't happen — header is inserted first)
  IF hdr_received_date IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT code INTO whse_code FROM org_config.locations WHERE id = hdr_location_id;
  IF whse_code IS NULL THEN
    whse_code := 'STORD';
  END IF;

  INSERT INTO orchard_calcs.receipt_lines (
    id, source, bronze_table, bronze_id,
    source_doc_no, received_date, warehouse_code, po_id, external_ref,
    item_id, qty_received, three_pl_sku, lot_number, created_at
  ) VALUES (
    NEW.id, 'stord', 'orchard.receipt_lines', NEW.id::text,
    hdr_external_id, hdr_received_date, whse_code, hdr_po_id, hdr_notes,
    NEW.item_id, NEW.qty_received, NEW.three_pl_sku, NEW.lot_number, NEW.created_at
  )
  ON CONFLICT (source, bronze_id) DO NOTHING;

  INSERT INTO orchard_calcs.receipt_line_statuses (receipt_line_id, status)
  VALUES (NEW.id, COALESCE(NEW.status, 'Open'))
  ON CONFLICT (receipt_line_id) DO NOTHING;

  RETURN NEW;
END $$ LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = orchard, orchard_calcs, org_config, public;

DROP TRIGGER IF EXISTS sync_stord_receipt_line_trg ON orchard.receipt_lines;
CREATE TRIGGER sync_stord_receipt_line_trg
  AFTER INSERT ON orchard.receipt_lines
  FOR EACH ROW
  EXECUTE FUNCTION orchard_calcs.sync_stord_receipt_line();

-- ─── GRANTs (custom schemas need explicit grants for PostgREST) ────

GRANT USAGE ON SCHEMA orchard_calcs TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON orchard_calcs.receipt_lines TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON orchard_calcs.receipt_line_statuses TO service_role;
GRANT SELECT ON orchard_calcs.v_receipts TO service_role;
