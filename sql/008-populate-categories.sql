-- Populate category for all items based on SKU prefix
-- Also normalizes "Electrolytes" → "Electrolyte" (singular)
-- Run this in the Supabase SQL Editor

UPDATE org_config.items SET category = 'Electrolyte' WHERE sku LIKE 'ELEC-%' AND (category IS NULL OR category = 'Electrolytes');
UPDATE org_config.items SET category = 'Creatine' WHERE sku LIKE 'CREA-%' AND category IS NULL;
UPDATE org_config.items SET category = 'Packaging' WHERE sku LIKE 'PKG-%' AND category IS NULL;
UPDATE org_config.items SET category = 'Merch' WHERE sku LIKE 'MERCH-%' AND category IS NULL;
