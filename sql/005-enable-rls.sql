-- ============================================================
-- Migration 005: Enable Row Level Security on all tables
-- Applied: 2026-04-23
-- ============================================================
-- With RLS enabled and no policies, only service_role can access.
-- The app uses SUPABASE_SERVICE_ROLE_KEY, so no policies needed yet.
-- anon and authenticated roles are fully blocked.
-- ============================================================

-- org_config (reference data)
ALTER TABLE org_config.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_config.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_config.locations ENABLE ROW LEVEL SECURITY;

-- orchard (Bronze — source documents)
ALTER TABLE orchard.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.po_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.invoices ENABLE ROW LEVEL SECURITY;

-- orchard (ingestion staging)
ALTER TABLE orchard.ingested_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.ingested_documents ENABLE ROW LEVEL SECURITY;

-- orchard (BMC / inventory)
ALTER TABLE orchard.inventory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.bmc_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard.item_costs ENABLE ROW LEVEL SECURITY;

-- orchard_calcs (Silver — linking & status)
ALTER TABLE orchard_calcs.po_line_receipt_line_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.po_line_invoice_line_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.receipt_line_invoice_line_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.wo_receipt_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.po_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.invoice_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE orchard_calcs.events ENABLE ROW LEVEL SECURITY;
