-- Rename movements.state -> movements.status for naming consistency
-- All other status columns in the app use "status"; "state" was inconsistent.
ALTER TABLE orchard_calcs.movements RENAME COLUMN state TO status;
