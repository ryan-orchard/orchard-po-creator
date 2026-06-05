-- Split receipt_line_statuses.status into transfer_status + invoice_status + flag.
-- transfer_status: was this line reconciled against a transfer shipment? (inventory tracking)
-- invoice_status:  was this line matched to a supplier invoice? (COGS)
-- flag:            operational annotation (excluded / review)

-- 1. Add new columns
ALTER TABLE orchard_calcs.receipt_line_statuses
  ADD COLUMN transfer_status text NOT NULL DEFAULT 'unmatched'
    CHECK (transfer_status IN ('unmatched', 'partial', 'matched')),
  ADD COLUMN invoice_status text NOT NULL DEFAULT 'unmatched'
    CHECK (invoice_status IN ('unmatched', 'matched')),
  ADD COLUMN flag text CHECK (flag IN ('excluded', 'review'));

-- 2. Migrate existing data

-- Excluded lines → flag
UPDATE orchard_calcs.receipt_line_statuses
SET flag = 'excluded'
WHERE status = 'Excluded';

-- Review lines → flag
UPDATE orchard_calcs.receipt_line_statuses
SET flag = 'review'
WHERE status = 'Review';

-- Matched lines → set transfer_status if a confirmed transfer link exists
UPDATE orchard_calcs.receipt_line_statuses rls
SET transfer_status = 'matched'
WHERE rls.status = 'Matched'
  AND EXISTS (
    SELECT 1 FROM orchard_calcs.transfer_line_receipt_line_links t
    WHERE t.receipt_line_id = rls.receipt_line_id
      AND t.confirmed = true
  );

-- Matched lines → set invoice_status if an invoice link exists
UPDATE orchard_calcs.receipt_line_statuses rls
SET invoice_status = 'matched'
WHERE rls.status = 'Matched'
  AND EXISTS (
    SELECT 1 FROM orchard_calcs.receipt_line_invoice_line_links i
    WHERE i.receipt_line_id = rls.receipt_line_id
  );

-- 3. Drop old status column
ALTER TABLE orchard_calcs.receipt_line_statuses DROP COLUMN status;

-- 4. Add receipts.status rollup column
ALTER TABLE orchard.receipts
  ADD COLUMN status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partial', 'matched'));

-- 5. Drop ghost table (written by deleted receipt-lines/match route, never read)
DROP TABLE IF EXISTS orchard_calcs.invoice_line_receipt_lines;
