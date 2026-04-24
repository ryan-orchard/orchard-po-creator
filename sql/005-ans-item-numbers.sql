-- Add ans_item_number column and populate ANS item mappings
-- Also creates 4 new items: ELEC-BLUEICE-14, CREA-PASSIONFRUIT-14, CREA-RASPBERRYLEMONADE-14, CREA-TEALEMONADE-14
-- Run this in the Supabase SQL Editor

-- =============================================================================
-- 1. Add ans_item_number column
-- =============================================================================
ALTER TABLE org_config.items ADD COLUMN IF NOT EXISTS ans_item_number TEXT;

-- =============================================================================
-- 2. Create 4 new items
-- =============================================================================
INSERT INTO org_config.items (sku, name, unit_of_measure, sticks_per_carton, description, is_active, category)
VALUES
  ('ELEC-BLUEICE-14', 'Electrolyte Blue Ice 14ct', 'Carton', 14, 'Electrolyte Blue Ice - 14ct Amazon', true, 'Electrolyte'),
  ('CREA-PASSIONFRUIT-14', 'Creatine Passion Fruit 14ct', 'Carton', 14, 'Creatine Passion Fruit - 14ct', true, 'Creatine'),
  ('CREA-RASPBERRYLEMONADE-14', 'Creatine Raspberry Lemonade 14ct', 'Carton', 14, 'Creatine Raspberry Lemonade - 14ct', true, 'Creatine'),
  ('CREA-TEALEMONADE-14', 'Creatine Tea Lemonade 14ct', 'Carton', 14, 'Creatine Tea Lemonade - 14ct', true, 'Creatine')
ON CONFLICT (sku) DO NOTHING;

-- =============================================================================
-- 3. Populate ans_item_number for all mapped items
-- =============================================================================

-- Electrolyte sticks
UPDATE org_config.items SET ans_item_number = 'F4063S-1-11L' WHERE sku = 'ELEC-LEMONLIME-STICK';
UPDATE org_config.items SET ans_item_number = 'F4064S-1-11L' WHERE sku = 'ELEC-TEALEMONADE-STICK';
UPDATE org_config.items SET ans_item_number = 'F4066S-1-11L' WHERE sku = 'ELEC-WATERMELONLIME-STICK';
UPDATE org_config.items SET ans_item_number = 'F4110S-1-11L' WHERE sku = 'ELEC-MINTLEMONADE-STICK';
UPDATE org_config.items SET ans_item_number = 'F4125S-1-11L' WHERE sku = 'ELEC-APPLEJUICE-STICK';
UPDATE org_config.items SET ans_item_number = 'F4157S-1-11L' WHERE sku = 'ELEC-BLOODORANGE-STICK';
UPDATE org_config.items SET ans_item_number = 'F4227S-1-11L' WHERE sku = 'ELEC-ISLANDPUNCH-STICK';
UPDATE org_config.items SET ans_item_number = 'F4273S-1-11L' WHERE sku = 'ELEC-PEACHTEA-STICK';
UPDATE org_config.items SET ans_item_number = 'F4283S-1-11L' WHERE sku = 'ELEC-BLUEICE-STICK';

-- Electrolyte 7ct
UPDATE org_config.items SET ans_item_number = 'F4063S-7-11L' WHERE sku = 'ELEC-LEMONLIME-7';
UPDATE org_config.items SET ans_item_number = 'F4064S-7-11L' WHERE sku = 'ELEC-TEALEMONADE-7';
UPDATE org_config.items SET ans_item_number = 'F4066S-7-11L' WHERE sku = 'ELEC-WATERMELONLIME-7';
UPDATE org_config.items SET ans_item_number = 'F4110S-7-11L' WHERE sku = 'ELEC-MINTLEMONADE-7';
UPDATE org_config.items SET ans_item_number = 'F4125S-7-11L' WHERE sku = 'ELEC-APPLEJUICE-7';
UPDATE org_config.items SET ans_item_number = 'F4157S-7-11L' WHERE sku = 'ELEC-BLOODORANGE-7';

-- Electrolyte 10ct
UPDATE org_config.items SET ans_item_number = 'F4063S-10-11L' WHERE sku = 'ELEC-LEMONLIME-10';
UPDATE org_config.items SET ans_item_number = 'F4066S-10-11L' WHERE sku = 'ELEC-WATERMELONLIME-10';
UPDATE org_config.items SET ans_item_number = 'F4110S-10-11L' WHERE sku = 'ELEC-MINTLEMONADE-10';
UPDATE org_config.items SET ans_item_number = 'F4125S-10-11L' WHERE sku = 'ELEC-APPLEJUICE-10';
UPDATE org_config.items SET ans_item_number = 'F4157S-10-11L' WHERE sku = 'ELEC-BLOODORANGE-10';

-- Electrolyte 14ct
UPDATE org_config.items SET ans_item_number = 'F4063S-14-11L' WHERE sku = 'ELEC-LEMONLIME-14';
UPDATE org_config.items SET ans_item_number = 'F4064S-14-11L' WHERE sku = 'ELEC-TEALEMONADE-14';
UPDATE org_config.items SET ans_item_number = 'F4066S-14-11L' WHERE sku = 'ELEC-WATERMELONLIME-14';
UPDATE org_config.items SET ans_item_number = 'F4110S-14-11L' WHERE sku = 'ELEC-MINTLEMONADE-14';
UPDATE org_config.items SET ans_item_number = 'F4125S-14-11L' WHERE sku = 'ELEC-APPLEJUICE-14';
UPDATE org_config.items SET ans_item_number = 'F4157S-14-11L' WHERE sku = 'ELEC-BLOODORANGE-14';
UPDATE org_config.items SET ans_item_number = 'F4227S-14-11L' WHERE sku = 'ELEC-ISLANDPUNCH-14';
UPDATE org_config.items SET ans_item_number = 'F4283S-14-11L' WHERE sku = 'ELEC-BLUEICE-14';

-- Electrolyte 28ct
UPDATE org_config.items SET ans_item_number = 'F4063S-28-11L' WHERE sku = 'ELEC-LEMONLIME-28';
UPDATE org_config.items SET ans_item_number = 'F4064S-28-11L' WHERE sku = 'ELEC-TEALEMONADE-28';
UPDATE org_config.items SET ans_item_number = 'F4066S-28-11L' WHERE sku = 'ELEC-WATERMELONLIME-28';
UPDATE org_config.items SET ans_item_number = 'F4110S-28-11L' WHERE sku = 'ELEC-MINTLEMONADE-28';
UPDATE org_config.items SET ans_item_number = 'F4125S-28-11L' WHERE sku = 'ELEC-APPLEJUICE-28';
UPDATE org_config.items SET ans_item_number = 'F4157S-28-11L' WHERE sku = 'ELEC-BLOODORANGE-28';
UPDATE org_config.items SET ans_item_number = 'F4227S-28-11L' WHERE sku = 'ELEC-ISLANDPUNCH-28';
UPDATE org_config.items SET ans_item_number = 'F4273S-28-11L' WHERE sku = 'ELEC-PEACHTEA-28';
UPDATE org_config.items SET ans_item_number = 'F4283S-28-11L' WHERE sku = 'ELEC-BLUEICE-28';
UPDATE org_config.items SET ans_item_number = 'F4334S-28-11L' WHERE sku = 'ELEC-RASPBERRYTEA-28';

-- Creatine sticks
UPDATE org_config.items SET ans_item_number = 'F4335S-1-10L' WHERE sku = 'CREA-PASSIONFRUIT-STICK';
UPDATE org_config.items SET ans_item_number = 'F4336S-1-10L' WHERE sku = 'CREA-RASPBERRYLEMONADE-STICK';
UPDATE org_config.items SET ans_item_number = 'F4337S-1-10L' WHERE sku = 'CREA-TEALEMONADE-STICK';

-- Creatine 14ct
UPDATE org_config.items SET ans_item_number = 'F4335S-14-10L' WHERE sku = 'CREA-PASSIONFRUIT-14';
UPDATE org_config.items SET ans_item_number = 'F4336S-14-10L' WHERE sku = 'CREA-RASPBERRYLEMONADE-14';
UPDATE org_config.items SET ans_item_number = 'F4337S-14-10L' WHERE sku = 'CREA-TEALEMONADE-14';

-- Kitted / variety packs
UPDATE org_config.items SET ans_item_number = 'FK4125S-2' WHERE sku = 'ELEC-APPLEJUICE-2';
UPDATE org_config.items SET ans_item_number = 'FK4230S-28' WHERE sku = 'ELEC-VARIETY-28';
UPDATE org_config.items SET ans_item_number = 'FK4251S-7' WHERE sku = 'ELEC-VARIETY-7';
UPDATE org_config.items SET ans_item_number = 'FK4252S-2' WHERE sku = 'ELEC-WL/LL-2';
UPDATE org_config.items SET ans_item_number = 'FK4255S-2' WHERE sku = 'ELEC-TL/BO-2';
UPDATE org_config.items SET ans_item_number = 'FK4256S-2' WHERE sku = 'ELEC-TL/ML-2';
UPDATE org_config.items SET ans_item_number = 'FK4257S-2' WHERE sku = 'ELEC-TL/WL-2';
UPDATE org_config.items SET ans_item_number = 'FK4258S-2' WHERE sku = 'ELEC-TL/LL-2';
UPDATE org_config.items SET ans_item_number = 'FK4262S-14' WHERE sku = 'ELEC-VARIETY-14';
UPDATE org_config.items SET ans_item_number = 'FK4355S-14' WHERE sku = 'CREA-VARIETYPACK-14';

-- NSF variant (maps to same stick SKU)
-- F4066S-11L (Watermelon Lime NSF) -> ELEC-WATERMELONLIME-STICK
-- Note: ans_item_number already set above for this SKU. If NSF needs separate tracking, create a new item.

-- =============================================================================
-- 4. Drop supplier_item_name column
-- =============================================================================
ALTER TABLE org_config.items DROP COLUMN IF EXISTS supplier_item_name;
