-- Add proper columns to items table, replacing metadata JSONB usage
-- Run this in the Supabase SQL Editor

-- =============================================================================
-- 1. Add new columns
-- =============================================================================
ALTER TABLE org_config.items ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE org_config.items ADD COLUMN IF NOT EXISTS supplier_item_name TEXT;
ALTER TABLE org_config.items ADD COLUMN IF NOT EXISTS bmc_item_no TEXT;
ALTER TABLE org_config.items ADD COLUMN IF NOT EXISTS stord_sku TEXT;

-- =============================================================================
-- 2. Migrate existing metadata values into new columns
-- =============================================================================
UPDATE org_config.items
SET
  category = metadata->>'category',
  supplier_item_name = metadata->>'supplierItemName',
  bmc_item_no = metadata->>'bmcItemNo'
WHERE metadata IS NOT NULL AND metadata != '{}'::jsonb;
