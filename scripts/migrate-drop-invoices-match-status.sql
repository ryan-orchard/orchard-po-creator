-- Drop the denormalized match_status column from orchard.invoices.
-- invoice_statuses (orchard_calcs) is now the sole source of truth for match_status.
-- All application reads and writes have been migrated off this column.
ALTER TABLE orchard.invoices DROP COLUMN match_status;
