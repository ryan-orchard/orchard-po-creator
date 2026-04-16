-- Ingest staging tables: emails and documents land here before
-- being reviewed and promoted to the main orchard.* tables.

-- Ingested emails — one row per inbound email
CREATE TABLE orchard.ingested_emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    TEXT UNIQUE NOT NULL,          -- Postmark MessageID (idempotency key)
  client_id     TEXT NOT NULL DEFAULT 'magna', -- which client inbox received this
  from_address  TEXT NOT NULL,
  from_name     TEXT,
  to_address    TEXT NOT NULL,
  subject       TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'received',  -- received | processing | processed | failed
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ingested documents — one row per attachment (or email body if no attachment)
CREATE TABLE orchard.ingested_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id         UUID REFERENCES orchard.ingested_emails(id),
  filename         TEXT,
  content_type     TEXT,                        -- application/pdf, application/vnd.ms-excel, etc.
  storage_path     TEXT,                        -- path in Supabase Storage bucket
  file_size_bytes  INT,

  -- AI classification
  document_type    TEXT,                        -- invoice | receipt | transaction_export | shipping_doc | unknown
  confidence       NUMERIC(3,2),               -- 0.00–1.00

  -- AI-extracted structured data
  parsed_data      JSONB,                       -- full extraction result (varies by document_type)

  -- Linking hints (from AI extraction)
  supplier_name    TEXT,                        -- extracted vendor/supplier name
  supplier_id      UUID,                        -- resolved → org_config.suppliers.id
  po_reference     TEXT,                        -- extracted PO number
  po_id            UUID,                        -- resolved → orchard.purchase_orders.id
  invoice_number   TEXT,                        -- extracted invoice number (for dedup)

  -- Review status
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | duplicate
  reviewed_at      TIMESTAMPTZ,
  reviewed_by      TEXT,

  -- What was created when approved
  created_record_type TEXT,                     -- invoice | receipt | etc.
  created_record_id   UUID,                     -- → the record that was created

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ingested_emails_status ON orchard.ingested_emails(status);
CREATE INDEX idx_ingested_emails_client ON orchard.ingested_emails(client_id);
CREATE INDEX idx_ingested_docs_status ON orchard.ingested_documents(status);
CREATE INDEX idx_ingested_docs_email ON orchard.ingested_documents(email_id);
CREATE INDEX idx_ingested_docs_invoice_num ON orchard.ingested_documents(invoice_number);

-- Storage bucket for raw attachments
-- Run in Supabase dashboard: Storage > New bucket > "ingest" (private)
