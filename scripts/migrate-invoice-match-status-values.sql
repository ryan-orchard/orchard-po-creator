-- Simplify invoice match_status values: Open → Unmatched, Approved → Matched
UPDATE orchard_calcs.invoice_statuses SET match_status = 'Unmatched' WHERE match_status = 'Open';
UPDATE orchard_calcs.invoice_statuses SET match_status = 'Matched'   WHERE match_status = 'Approved';
