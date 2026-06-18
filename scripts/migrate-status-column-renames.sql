-- 1. Rename po_line_statuses.state → po_line_statuses.status
ALTER TABLE orchard_calcs.po_line_statuses
  RENAME COLUMN state TO status;

-- 2. Split receipts.status into transfer_status + invoice_status
--    (receipts.status was a transfer-only rollup; now mirrors receipt_line_statuses structure)
ALTER TABLE orchard.receipts
  ADD COLUMN transfer_status text NOT NULL DEFAULT 'unmatched'
    CHECK (transfer_status IN ('unmatched', 'partial', 'matched')),
  ADD COLUMN invoice_status text NOT NULL DEFAULT 'unmatched'
    CHECK (invoice_status IN ('unmatched', 'matched'));

-- Migrate existing receipts.status values into transfer_status
UPDATE orchard.receipts
SET transfer_status = CASE status
  WHEN 'open'    THEN 'unmatched'
  WHEN 'partial' THEN 'partial'
  WHEN 'matched' THEN 'matched'
  ELSE 'unmatched'
END;

ALTER TABLE orchard.receipts DROP COLUMN status;
