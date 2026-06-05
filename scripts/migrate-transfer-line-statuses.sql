-- Add transfer_line_statuses table, mirroring the po_line_statuses pattern.
-- transfers.status will be computed from this table on read; it is no longer
-- written directly except as a cached convenience column (kept for now to
-- avoid breaking any raw SQL queries against orchard.transfers).

CREATE TABLE orchard_calcs.transfer_line_statuses (
  transfer_line_id uuid PRIMARY KEY REFERENCES orchard.transfer_lines(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'in_transit'
                   CHECK (status IN ('in_transit', 'partial', 'received', 'cancelled')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text
);
