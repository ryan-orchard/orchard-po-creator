-- Fix silver-promotion triggers broken by the receipt_line_statuses split.
--
-- migrate-receipt-line-statuses-split.sql dropped orchard_calcs.receipt_line_statuses.status
-- (replaced by transfer_status / invoice_status / flag), but the two promotion
-- trigger functions still INSERT the old `status` column, so EVERY receipt_lines
-- insert errors with: column "status" of relation "receipt_line_statuses" does not exist.
-- This silently broke all receipt creation (Stord auto-ingest, BMC sync, and the
-- manual /api/receipts path) since the migration.
--
-- Fix: insert only receipt_line_id and let the new columns default
-- (transfer_status='unmatched', invoice_status='unmatched', flag=NULL), which is
-- exactly what the old status='Open' represented. Function bodies are otherwise
-- unchanged. CREATE OR REPLACE keeps the existing triggers bound.

CREATE OR REPLACE FUNCTION orchard_calcs.sync_stord_receipt_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'orchard', 'orchard_calcs', 'org_config', 'public'
AS $function$
DECLARE
  hdr_received_date DATE;
  hdr_external_id   TEXT;
  hdr_location_id   UUID;
  hdr_po_id         UUID;
  whse_code         TEXT;
  v_silver_id       UUID;
BEGIN
  SELECT received_date, external_id, location_id, po_id
    INTO hdr_received_date, hdr_external_id, hdr_location_id, hdr_po_id
  FROM orchard.receipts WHERE id = NEW.receipt_id;

  IF hdr_received_date IS NULL THEN RETURN NEW; END IF;
  IF NEW.qty_received IS NULL OR NEW.qty_received <= 0 THEN RETURN NEW; END IF;

  SELECT code INTO whse_code FROM org_config.locations WHERE id = hdr_location_id;
  IF whse_code IS NULL THEN whse_code := 'STORD'; END IF;

  INSERT INTO orchard_calcs.receipt_lines (
    source, received_date, warehouse_code, source_doc_no,
    item_id, three_pl_sku, lot_number, qty_received, bronze_count, po_id
  ) VALUES (
    'stord', hdr_received_date, whse_code, hdr_external_id,
    NEW.item_id, NEW.three_pl_sku, NULLIF(UPPER(NEW.lot_number), ''),
    NEW.qty_received, 1, hdr_po_id
  )
  ON CONFLICT ON CONSTRAINT receipt_lines_group_unique DO UPDATE SET
    qty_received = orchard_calcs.receipt_lines.qty_received + EXCLUDED.qty_received,
    bronze_count = orchard_calcs.receipt_lines.bronze_count + 1,
    updated_at   = NOW()
  RETURNING id INTO v_silver_id;

  INSERT INTO orchard_calcs.receipt_line_statuses (receipt_line_id)
  VALUES (v_silver_id)
  ON CONFLICT (receipt_line_id) DO NOTHING;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION orchard_calcs.sync_bmc_purchase_to_receipts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'orchard', 'orchard_calcs', 'org_config', 'public'
AS $function$
DECLARE
  v_silver_id UUID;
  v_qty       NUMERIC;
BEGIN
  IF NEW.entry_type NOT IN ('Purchase', 'Output') THEN RETURN NEW; END IF;

  v_qty := COALESCE(NEW.base_quantity, NEW.quantity, 0);
  IF v_qty <= 0 THEN RETURN NEW; END IF;

  INSERT INTO orchard_calcs.receipt_lines (
    source, received_date, warehouse_code, source_doc_no,
    item_id, three_pl_sku, lot_number, qty_received, bronze_count, po_id
  ) VALUES (
    'bmc', NEW.posting_date, 'BMC', NEW.document_no,
    NEW.item_id, NEW.bmc_item_no, NULLIF(UPPER(NEW.lot_no), ''),
    v_qty, 1, NULL
  )
  ON CONFLICT ON CONSTRAINT receipt_lines_group_unique DO UPDATE SET
    qty_received = orchard_calcs.receipt_lines.qty_received + EXCLUDED.qty_received,
    bronze_count = orchard_calcs.receipt_lines.bronze_count + 1,
    updated_at   = NOW()
  RETURNING id INTO v_silver_id;

  INSERT INTO orchard_calcs.receipt_line_statuses (receipt_line_id)
  VALUES (v_silver_id)
  ON CONFLICT (receipt_line_id) DO NOTHING;

  RETURN NEW;
END $function$;
