-- Normalize invoice_statuses values to lowercase
UPDATE orchard_calcs.invoice_statuses SET match_status   = 'unmatched' WHERE match_status   = 'Unmatched';
UPDATE orchard_calcs.invoice_statuses SET match_status   = 'matched'   WHERE match_status   = 'Matched';
UPDATE orchard_calcs.invoice_statuses SET payment_status = 'open'      WHERE payment_status = 'Open';
UPDATE orchard_calcs.invoice_statuses SET payment_status = 'approved'  WHERE payment_status = 'Approved';

-- Add CHECK constraints to enforce lowercase going forward
ALTER TABLE orchard_calcs.invoice_statuses
  ADD CONSTRAINT invoice_statuses_match_status_check
    CHECK (match_status IN ('unmatched', 'matched')),
  ADD CONSTRAINT invoice_statuses_payment_status_check
    CHECK (payment_status IN ('open', 'approved'));
