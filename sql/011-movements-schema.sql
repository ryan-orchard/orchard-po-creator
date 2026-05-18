-- ============================================================
-- Migration 011: Movements layer — schema only (no seed, no triggers)
-- ============================================================
-- Adds the inventory movement ledger as a silver layer derived from
-- bronze sources. Movements are the source of truth for what happened
-- to inventory; documents (POs, receipts, invoices, BMC entries) are
-- inputs.
--
-- Tables created:
--   org_config.location_roles      — one location can play many roles
--   org_config.paths               — catalog of legal movement tuples
--   orchard.stord_adjustments      — bronze: Stord inventory adjustments report
--   orchard.po_line_statuses       — line-level state, fed by ANS weekly report
--   orchard_calcs.movements        — silver: atomic inventory events
--   orchard_calcs.movement_costs   — cost allocations to movements
--
-- Columns added:
--   org_config.items.accounting_category  — Components | FG | Packaging
--   (existing `category` column stays as-is — that's by product line)
--
-- Seed data and triggers come in separate migrations.
-- ============================================================

-- =============================================================================
-- 1. org_config.location_roles
-- =============================================================================
-- A location can have multiple roles. ANS is supplier + warehouse + kitting.

CREATE TABLE IF NOT EXISTS org_config.location_roles (
  location_id  UUID NOT NULL REFERENCES org_config.locations(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (location_id, role),
  CONSTRAINT location_roles_role_chk
    CHECK (role IN ('supplier','warehouse','kitting','transportation','customer'))
);

CREATE INDEX IF NOT EXISTS location_roles_role_idx
  ON org_config.location_roles(role);

-- =============================================================================
-- 2. org_config.paths — catalog of legal movement tuples
-- =============================================================================
-- Matching: when a movement is created, look for paths where the populated
-- fields match. Exactly one match → auto-link. None → flag as new path.

CREATE TABLE IF NOT EXISTS org_config.paths (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           TEXT NOT NULL DEFAULT 'magna',
  type                TEXT NOT NULL,
  from_location_role  TEXT,
  from_location_id    UUID REFERENCES org_config.locations(id),
  to_location_role    TEXT,
  to_location_id      UUID REFERENCES org_config.locations(id),
  item_category       TEXT,
  carrier             TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT paths_type_chk
    CHECK (type IN ('Acquisition','Movement','Fulfillment','Adjustment')),
  CONSTRAINT paths_from_role_chk
    CHECK (from_location_role IS NULL OR from_location_role IN ('supplier','warehouse','customer')),
  CONSTRAINT paths_to_role_chk
    CHECK (to_location_role IS NULL OR to_location_role IN ('supplier','warehouse','customer')),
  CONSTRAINT paths_category_chk
    CHECK (item_category IS NULL OR item_category IN ('Components','FG','Packaging'))
);

CREATE INDEX IF NOT EXISTS paths_lookup_idx
  ON org_config.paths(type, from_location_role, to_location_role, item_category)
  WHERE is_active = TRUE;

-- =============================================================================
-- 3. org_config.items.accounting_category
-- =============================================================================
-- New column for the item's role in inventory cost flow (Components | FG | Packaging).
-- Distinct from the existing `category` column, which tracks product line
-- (Electrolyte | Creatine | Merch | Packaging). Nullable until seed populates.

ALTER TABLE org_config.items
  ADD COLUMN IF NOT EXISTS accounting_category TEXT;

ALTER TABLE org_config.items
  DROP CONSTRAINT IF EXISTS items_accounting_category_chk;

ALTER TABLE org_config.items
  ADD CONSTRAINT items_accounting_category_chk
  CHECK (accounting_category IS NULL OR accounting_category IN ('Components','FG','Packaging'));

CREATE INDEX IF NOT EXISTS items_accounting_category_idx
  ON org_config.items(accounting_category) WHERE accounting_category IS NOT NULL;

-- =============================================================================
-- 4. orchard.stord_adjustments — bronze for Stord adjustments report
-- =============================================================================
-- Raw rows ingested from the Stord inventory adjustments report.
-- Filter rules TBD with Ryan — likely WHERE adjustment_reason IN (...).
-- This table is append-only; never edit existing rows.

CREATE TABLE IF NOT EXISTS orchard.stord_adjustments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          TEXT NOT NULL DEFAULT 'magna',
  -- Source row identity (idempotency)
  external_id        TEXT NOT NULL,                  -- Stord's row identifier
  report_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Adjustment payload
  adjustment_date    DATE NOT NULL,
  adjustment_reason  TEXT,                            -- raw reason from Stord
  three_pl_sku       TEXT,
  item_id            UUID REFERENCES org_config.items(id),
  qty                NUMERIC NOT NULL,                -- signed; +in, -out
  lot_number         TEXT,
  reference_doc      TEXT,                            -- e.g. PO# or shipment# if Stord provides
  raw_payload        JSONB,                           -- entire source row for audit
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT stord_adjustments_external_id_unique UNIQUE (external_id)
);

CREATE INDEX IF NOT EXISTS stord_adjustments_date_idx
  ON orchard.stord_adjustments(adjustment_date);
CREATE INDEX IF NOT EXISTS stord_adjustments_item_idx
  ON orchard.stord_adjustments(item_id) WHERE item_id IS NOT NULL;

-- =============================================================================
-- 5. orchard.po_line_statuses — line-level state, fed by ANS weekly report
-- =============================================================================
-- One row per PO line. The ANS weekly status report upserts these.
-- Treated as bronze (source-fed). No history retained in this table;
-- raw reports are kept as files for audit.

CREATE TABLE IF NOT EXISTS orchard.po_line_statuses (
  po_line_id            UUID PRIMARY KEY REFERENCES orchard.po_lines(id) ON DELETE CASCADE,
  state                 TEXT NOT NULL DEFAULT 'ordered',
  expected_ship_date    DATE,
  expected_receive_date DATE,
  cancelled_qty         NUMERIC NOT NULL DEFAULT 0,
  source_report_date    DATE,                          -- date of the ANS report that wrote this row
  notes                 TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            TEXT,

  CONSTRAINT po_line_statuses_state_chk
    CHECK (state IN ('ordered','confirmed','in_transit','received','invoiced','costed','paid','cancelled'))
);

CREATE INDEX IF NOT EXISTS po_line_statuses_state_idx
  ON orchard.po_line_statuses(state);

-- =============================================================================
-- 6. orchard_calcs.movements — silver: atomic inventory events
-- =============================================================================
-- One row per item moving once. Generated from bronze sources via triggers
-- or one-time backfill jobs. Never written from the app directly except
-- for the April baseline seed (one-time exception).

CREATE TABLE IF NOT EXISTS orchard_calcs.movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         TEXT NOT NULL DEFAULT 'magna',
  type              TEXT NOT NULL,
  -- Endpoints (nullable depending on type — see CHECK below)
  from_location_id  UUID REFERENCES org_config.locations(id),
  to_location_id    UUID REFERENCES org_config.locations(id),
  -- What and how much
  item_id           UUID NOT NULL REFERENCES org_config.items(id),
  qty               NUMERIC NOT NULL,
  uom               TEXT,
  -- When
  occurred_at       TIMESTAMPTZ NOT NULL,
  posted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- How (carrier, optional)
  carrier           TEXT,
  -- Lookup links
  path_id           UUID REFERENCES org_config.paths(id),
  source_doc_type   TEXT NOT NULL,
  source_doc_id     UUID,                              -- soft FK; resolution depends on source_doc_type
  -- Lifecycle
  state             TEXT NOT NULL DEFAULT 'pending',
  reversed_by_id    UUID REFERENCES orchard_calcs.movements(id),
  -- Misc
  lot_number        TEXT,                              -- carried through if present in source
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT movements_type_chk
    CHECK (type IN ('Acquisition','Movement','Fulfillment','Adjustment')),
  CONSTRAINT movements_state_chk
    CHECK (state IN ('pending','confirmed','costed','reconciled','reversed')),
  CONSTRAINT movements_source_doc_type_chk
    CHECK (source_doc_type IN (
      'po_line','shipment_line','stord_adjustment','bmc_txn',
      'wo_consumption','wo_output','fulfillment_order_line','manual'
    )),
  -- Endpoint rules by type
  CONSTRAINT movements_endpoints_chk CHECK (
    (type = 'Acquisition'  AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL) OR
    (type = 'Movement'     AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL) OR
    (type = 'Fulfillment'  AND from_location_id IS NOT NULL) OR
    (type = 'Adjustment'   AND (from_location_id IS NULL) <> (to_location_id IS NULL))
  ),
  CONSTRAINT movements_qty_positive_chk CHECK (qty > 0)
);

CREATE INDEX IF NOT EXISTS movements_occurred_at_idx
  ON orchard_calcs.movements(occurred_at);
CREATE INDEX IF NOT EXISTS movements_item_idx
  ON orchard_calcs.movements(item_id);
CREATE INDEX IF NOT EXISTS movements_from_idx
  ON orchard_calcs.movements(from_location_id) WHERE from_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS movements_to_idx
  ON orchard_calcs.movements(to_location_id) WHERE to_location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS movements_source_idx
  ON orchard_calcs.movements(source_doc_type, source_doc_id);
CREATE INDEX IF NOT EXISTS movements_path_idx
  ON orchard_calcs.movements(path_id) WHERE path_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS movements_state_idx
  ON orchard_calcs.movements(state);
CREATE INDEX IF NOT EXISTS movements_type_idx
  ON orchard_calcs.movements(type);

-- =============================================================================
-- 7. orchard_calcs.movement_costs — cost allocation to movements
-- =============================================================================
-- Many-to-many between invoice lines and movements. One movement can have
-- multiple cost rows (goods + freight). One invoice line can spread across
-- multiple movements via pro-rata allocation.

CREATE TABLE IF NOT EXISTS orchard_calcs.movement_costs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id        UUID NOT NULL REFERENCES orchard_calcs.movements(id) ON DELETE CASCADE,
  invoice_line_id    UUID,                             -- nullable: allows manual costs
  cost_type          TEXT NOT NULL,
  amount             NUMERIC NOT NULL,
  allocation_method  TEXT NOT NULL,
  allocated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT movement_costs_cost_type_chk
    CHECK (cost_type IN ('goods','freight','duty','other')),
  CONSTRAINT movement_costs_method_chk
    CHECK (allocation_method IN ('direct','pro_rata_qty','pro_rata_value','manual'))
);

CREATE INDEX IF NOT EXISTS movement_costs_movement_idx
  ON orchard_calcs.movement_costs(movement_id);
CREATE INDEX IF NOT EXISTS movement_costs_invoice_line_idx
  ON orchard_calcs.movement_costs(invoice_line_id) WHERE invoice_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS movement_costs_cost_type_idx
  ON orchard_calcs.movement_costs(cost_type);

-- =============================================================================
-- 8. Row Level Security (matches existing pattern from migration 005)
-- =============================================================================

ALTER TABLE org_config.location_roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_config.paths               ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.stord_adjustments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.po_line_statuses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.movements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.movement_costs   ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 9. Grants (PostgREST needs explicit grants for custom schemas)
-- =============================================================================

GRANT USAGE ON SCHEMA orchard_calcs TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON org_config.location_roles      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_config.paths               TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON orchard.stord_adjustments      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON orchard.po_line_statuses       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON orchard_calcs.movements        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON orchard_calcs.movement_costs   TO service_role;
