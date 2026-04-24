-- Add missing Stord carton mappings and create new PKG/ELEC items
-- Run this in the Supabase SQL Editor

-- =============================================================================
-- 1. Create 7 new items (all packaging except ELEC-UNFLAVORED-28)
-- =============================================================================
INSERT INTO org_config.items (sku, name, unit_of_measure, sticks_per_carton, description, is_active, category)
VALUES
  ('PKG-WATERMELONLIME-28', 'Empty Carton Watermelon Lime 28ct', 'Each', NULL, 'Empty Carton - Watermelon Lime 28ct', true, 'Packaging'),
  ('PKG-LEMONLIME-28', 'Empty Carton Lemon Lime 28ct', 'Each', NULL, 'Empty Carton - Lemon Lime 28ct', true, 'Packaging'),
  ('PKG-MINTLEMONADE-28', 'Empty Carton Mint Lemonade 28ct', 'Each', NULL, 'Empty Carton - Mint Lemonade 28ct', true, 'Packaging'),
  ('PKG-TEALEMONADE-28', 'Empty Carton Tea Lemonade 28ct', 'Each', NULL, 'Empty Carton - Tea Lemonade 28ct', true, 'Packaging'),
  ('ELEC-UNFLAVORED-28', 'Electrolyte Unflavored 28ct', 'Carton', 28, 'Electrolyte Unflavored - 28ct Carton', true, 'Electrolyte'),
  ('PKG-UNFLAVORED-28', 'Empty Carton Unflavored 28ct', 'Each', NULL, 'Empty Carton - Unflavored 28ct', true, 'Packaging'),
  ('PKG-VARIETY-28', 'Empty Carton Variety Pack 28ct', 'Each', NULL, 'Empty Carton - Variety Pack 28ct', true, 'Packaging')
ON CONFLICT (sku) DO NOTHING;

-- =============================================================================
-- 2. Map stord_sku values
-- =============================================================================

-- Existing items — just adding stord_sku
UPDATE org_config.items SET stord_sku = 'Carton-Apple-Jui' WHERE sku = 'PKG-APPLEJUICE-28';
UPDATE org_config.items SET stord_sku = 'CARTON-BLOOD ORANGE' WHERE sku = 'PKG-BLOODORANGE-28';

-- ELEC-BLOODORANGE-28 already has stord_sku = '1CARTON-...' — add CARTON-BLOOD-ORG only if empty
UPDATE org_config.items SET stord_sku = 'CARTON-BLOOD-ORG' WHERE sku = 'ELEC-BLOODORANGE-28' AND stord_sku IS NULL;

-- New items
UPDATE org_config.items SET stord_sku = 'CARTON - WATERMELON' WHERE sku = 'PKG-WATERMELONLIME-28';
UPDATE org_config.items SET stord_sku = 'CARTON-LEMON-LIME' WHERE sku = 'PKG-LEMONLIME-28';
UPDATE org_config.items SET stord_sku = 'Carton-Mint-Lemo' WHERE sku = 'PKG-MINTLEMONADE-28';
UPDATE org_config.items SET stord_sku = 'CARTON-TEA-LEMONADE' WHERE sku = 'PKG-TEALEMONADE-28';
UPDATE org_config.items SET stord_sku = 'CARTON-UNFLAVOR' WHERE sku = 'ELEC-UNFLAVORED-28';
UPDATE org_config.items SET stord_sku = 'CARTON-UNFLAVORED' WHERE sku = 'PKG-UNFLAVORED-28';
UPDATE org_config.items SET stord_sku = 'CARTON-VARIETY-PACK' WHERE sku = 'PKG-VARIETY-28';
