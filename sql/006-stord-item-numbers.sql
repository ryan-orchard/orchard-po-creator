-- Populate stord_sku for all Stord items and create 10 new items
-- Run this in the Supabase SQL Editor
-- stord_sku column already exists from 004-items-columns.sql

-- =============================================================================
-- 1. Create 10 new items
-- =============================================================================
INSERT INTO org_config.items (sku, name, unit_of_measure, sticks_per_carton, description, is_active, category)
VALUES
  ('ELEC-PEACHMANGO-28', 'Electrolyte Peach Mango 28ct', 'Carton', 28, 'Electrolyte Peach Mango - 28ct Carton', true, 'Electrolyte'),
  ('ELEC-ISLANDPUNCH-7', 'Electrolyte Island Punch 7ct', 'Carton', 7, 'Electrolyte Island Punch - 7ct Amazon', true, 'Electrolyte'),
  ('ELEC-BLUEICE-2', 'Electrolyte Blue Ice 2ct', 'Each', NULL, 'Electrolyte Blue Ice - 2ct Sample', true, 'Electrolyte'),
  ('ELEC-PEACHTEA-2', 'Electrolyte Peach Tea 2ct', 'Each', NULL, 'Electrolyte Peach Tea - 2ct Sample', true, 'Electrolyte'),
  ('ELEC-RASPBERRY-2', 'Electrolyte Raspberry 2ct', 'Each', NULL, 'Electrolyte Raspberry - 2ct Sample', true, 'Electrolyte'),
  ('ELEC-UNFLAVORED-2', 'Electrolyte Unflavored 2ct', 'Each', NULL, 'Electrolyte Unflavored - 2ct Sample', true, 'Electrolyte'),
  ('ELEC-SUMMERBERRIES-2', 'Electrolyte Summer Berries 2ct', 'Each', NULL, 'Electrolyte Summer Berries - 2ct Sample', true, 'Electrolyte'),
  ('PKG-ENV-8CT', 'Packaging Envelope 8ct', 'Each', NULL, 'Packaging Envelope - 8ct', true, 'Packaging'),
  ('MERCH-BOTTLE-BLACK', 'Magna Black Bottle', 'Each', NULL, 'Magna Black Water Bottle', true, 'Merch'),
  ('MERCH-TEE-XS', 'Magna World Tee XS', 'Each', NULL, 'Magna World Tee - XS', true, 'Merch')
ON CONFLICT (sku) DO NOTHING;

-- =============================================================================
-- 2. Populate stord_sku for all mapped items
-- =============================================================================

-- Electrolyte sticks
UPDATE org_config.items SET stord_sku = 'STICK-BLOOD ORG' WHERE sku = 'ELEC-BLOODORANGE-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-TEA-LEMONADE' WHERE sku = 'ELEC-TEALEMONADE-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-LEMON-LIME' WHERE sku = 'ELEC-LEMONLIME-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-MINT LEMON' WHERE sku = 'ELEC-MINTLEMONADE-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-WATERMELON-LIME' WHERE sku = 'ELEC-WATERMELONLIME-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-BLUE-ICE' WHERE sku = 'ELEC-BLUEICE-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-ISLAND-PUNCH' WHERE sku = 'ELEC-ISLANDPUNCH-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-APPLE-JUICE' WHERE sku = 'ELEC-APPLEJUICE-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-PEACH-MANGO' WHERE sku = 'ELEC-PEACHMANGO-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-STRAWBERRY' WHERE sku = 'ELEC-STRAWBERRY-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-RASPBERRY' WHERE sku = 'ELEC-RASPBERRY-STICK';
UPDATE org_config.items SET stord_sku = 'STICK-UNFLAVORED' WHERE sku = 'ELEC-UNFLAVORED-STICK';

-- 28ct cartons
UPDATE org_config.items SET stord_sku = '1CARTON-TEA-LEMONADE' WHERE sku = 'ELEC-TEALEMONADE-28';
UPDATE org_config.items SET stord_sku = '1CARTON-MINT-LEMONADE' WHERE sku = 'ELEC-MINTLEMONADE-28';
UPDATE org_config.items SET stord_sku = '1CARTON-BLUE-ICE' WHERE sku = 'ELEC-BLUEICE-28';
UPDATE org_config.items SET stord_sku = '1CARTON-LEMON-LIME' WHERE sku = 'ELEC-LEMONLIME-28';
UPDATE org_config.items SET stord_sku = '1CARTON-ISLAND-PUNCH' WHERE sku = 'ELEC-ISLANDPUNCH-28';
UPDATE org_config.items SET stord_sku = '1CARTON-WATERMELON-LIME' WHERE sku = 'ELEC-WATERMELONLIME-28';
UPDATE org_config.items SET stord_sku = '1CARTON-APPLE-JUICE' WHERE sku = 'ELEC-APPLEJUICE-28';
UPDATE org_config.items SET stord_sku = '1CARTON-VARIETY-PACK' WHERE sku = 'ELEC-VARIETY-28';
UPDATE org_config.items SET stord_sku = '1CARTON-PEACH-MANGO' WHERE sku = 'ELEC-PEACHMANGO-28';

-- 10ct
UPDATE org_config.items SET stord_sku = '10CT-LEMON-LIME' WHERE sku = 'ELEC-LEMONLIME-10';
UPDATE org_config.items SET stord_sku = '10CT-APPLE-JUICE' WHERE sku = 'ELEC-APPLEJUICE-10';
UPDATE org_config.items SET stord_sku = '10CT-WATERMELON-LIME' WHERE sku = 'ELEC-WATERMELONLIME-10';
UPDATE org_config.items SET stord_sku = '10CT-TEA-LEMONADE' WHERE sku = 'ELEC-TEALEMONADE-10';
UPDATE org_config.items SET stord_sku = '10CT-BLOOD-ORANGE' WHERE sku = 'ELEC-BLOODORANGE-10';

-- 7ct
UPDATE org_config.items SET stord_sku = 'MAGMTL0701' WHERE sku = 'ELEC-MINTLEMONADE-7';
UPDATE org_config.items SET stord_sku = 'MAGTLM0701' WHERE sku = 'ELEC-TEALEMONADE-7';
UPDATE org_config.items SET stord_sku = 'MAGLML0701' WHERE sku = 'ELEC-LEMONLIME-7';
UPDATE org_config.items SET stord_sku = 'MAGBLO0701' WHERE sku = 'ELEC-BLOODORANGE-7';
UPDATE org_config.items SET stord_sku = 'MAGWTL0701' WHERE sku = 'ELEC-WATERMELONLIME-7';
UPDATE org_config.items SET stord_sku = 'MAGAJU0701' WHERE sku = 'ELEC-APPLEJUICE-7';
UPDATE org_config.items SET stord_sku = 'MAGIP0701' WHERE sku = 'ELEC-ISLANDPUNCH-7';

-- 14ct
UPDATE org_config.items SET stord_sku = 'MAGTLM1401' WHERE sku = 'ELEC-TEALEMONADE-14';
UPDATE org_config.items SET stord_sku = 'MAGIP1401' WHERE sku = 'ELEC-ISLANDPUNCH-14';
UPDATE org_config.items SET stord_sku = 'MAGLML1401' WHERE sku = 'ELEC-LEMONLIME-14';
UPDATE org_config.items SET stord_sku = 'MAGWTL1401' WHERE sku = 'ELEC-WATERMELONLIME-14';
UPDATE org_config.items SET stord_sku = 'MAGBLO1401' WHERE sku = 'ELEC-BLOODORANGE-14';
UPDATE org_config.items SET stord_sku = 'MAGMTL1401' WHERE sku = 'ELEC-MINTLEMONADE-14';
UPDATE org_config.items SET stord_sku = 'MAGAJU1401' WHERE sku = 'ELEC-APPLEJUICE-14';
UPDATE org_config.items SET stord_sku = 'MAGVRP1401' WHERE sku = 'ELEC-VARIETY-14';
UPDATE org_config.items SET stord_sku = '14CT-BLUE ICE' WHERE sku = 'ELEC-BLUEICE-14';
UPDATE org_config.items SET stord_sku = '14CT-RASPBERRY LEMONADE-CREATINE' WHERE sku = 'CREA-RASPBERRYLEMONADE-14';
UPDATE org_config.items SET stord_sku = '14CT-ICED TEA LEMONADE-CREATINE' WHERE sku = 'CREA-TEALEMONADE-14';
UPDATE org_config.items SET stord_sku = '14CT-PASSION FRUIT-CREATINE' WHERE sku = 'CREA-PASSIONFRUIT-14';

-- 2ct sample packs
UPDATE org_config.items SET stord_sku = '2CT Smpl - TL/LL' WHERE sku = 'ELEC-TL/LL-2';
UPDATE org_config.items SET stord_sku = '2CT Smpl - WL/LL' WHERE sku = 'ELEC-WL/LL-2';
UPDATE org_config.items SET stord_sku = '2CT Smpl - TL/WL' WHERE sku = 'ELEC-TL/WL-2';
UPDATE org_config.items SET stord_sku = '2CT Smpl - TL/ML' WHERE sku = 'ELEC-TL/ML-2';
UPDATE org_config.items SET stord_sku = '2CT Smpl - TL/BO' WHERE sku = 'ELEC-TL/BO-2';
UPDATE org_config.items SET stord_sku = '2CT Smpl - STR/RSP' WHERE sku = 'ELEC-STR/RSP-2';
UPDATE org_config.items SET stord_sku = '2CT Smpl - IP' WHERE sku = 'ELEC-ISLANDPUNCH-2';
UPDATE org_config.items SET stord_sku = '2CT - BLOOD ORG' WHERE sku = 'ELEC-BLOODORANGE-2';
UPDATE org_config.items SET stord_sku = '2CT Smpl - BI' WHERE sku = 'ELEC-BLUEICE-2';
UPDATE org_config.items SET stord_sku = '2CT Smpl - PT' WHERE sku = 'ELEC-PEACHTEA-2';
UPDATE org_config.items SET stord_sku = '2ct-Raspberry' WHERE sku = 'ELEC-RASPBERRY-2';
UPDATE org_config.items SET stord_sku = '2CT-UNFLAVORED' WHERE sku = 'ELEC-UNFLAVORED-2';

-- 2ct finished goods (same Orchard SKU as samples — these are the filled versions)
UPDATE org_config.items SET stord_sku = '2ct FIN GD - ML' WHERE sku = 'ELEC-MINTLEMONADE-2' AND stord_sku IS NULL;
UPDATE org_config.items SET stord_sku = '2CT FINISHED GOOD - LEMON LIME' WHERE sku = 'ELEC-LEMONLIME-2' AND stord_sku IS NULL;
UPDATE org_config.items SET stord_sku = '2CT FINISHED GOOD - WATERMELON LIME' WHERE sku = 'ELEC-WATERMELONLIME-2' AND stord_sku IS NULL;
UPDATE org_config.items SET stord_sku = '2CT FINISHED GOOD - TEA LEMONADE' WHERE sku = 'ELEC-TEALEMONADE-2' AND stord_sku IS NULL;
UPDATE org_config.items SET stord_sku = '2CT FINISHED GOOD - APPLE JUICE' WHERE sku = 'ELEC-APPLEJUICE-2' AND stord_sku IS NULL;
UPDATE org_config.items SET stord_sku = '2CT FINISHED GOOD - SUMMER BERRIES' WHERE sku = 'ELEC-SUMMERBERRIES-2';

-- 8ct sampler
UPDATE org_config.items SET stord_sku = '8-CT-SAMPLER - FINISHED GOOD' WHERE sku = 'ELEC-SAMPLER-8';

-- Packaging
UPDATE org_config.items SET stord_sku = 'PKGENV0201' WHERE sku = 'PKG-ENV-2CT';
UPDATE org_config.items SET stord_sku = 'PKGENV0701' WHERE sku = 'PKG-ENV-7CT';
UPDATE org_config.items SET stord_sku = 'PKGENV1401' WHERE sku = 'PKG-ENV-14CT';
UPDATE org_config.items SET stord_sku = '1CT-SHIPPING-BOX' WHERE sku = 'PKG-SHIPBOX-1CT';
UPDATE org_config.items SET stord_sku = '2-CT-SHIPPING-BOX' WHERE sku = 'PKG-SHIPBOX-2CT';
UPDATE org_config.items SET stord_sku = '3-4-CT-SHIPPING-BOX' WHERE sku = 'PKG-SHIPBOX-3-4CT';
UPDATE org_config.items SET stord_sku = '8-CT-SHIPPING-ENVELOPE' WHERE sku = 'PKG-ENV-8CT';
UPDATE org_config.items SET stord_sku = 'PKGWML1001' WHERE sku = 'PKG-WATERMELONLIME-10';
UPDATE org_config.items SET stord_sku = 'PKGTLM1001' WHERE sku = 'PKG-TEALEMONADE-10';
UPDATE org_config.items SET stord_sku = 'PKGLML1001' WHERE sku = 'PKG-LEMONLIME-10';
UPDATE org_config.items SET stord_sku = 'PACKAGE - 2CT *NO* QR CODE SURPRISE PACK' WHERE sku = 'PKG-2CT-NOQR-SURPRISE';
UPDATE org_config.items SET stord_sku = 'PACKAGE - 2CT W/QR CODE FIELD MARKETING PACK' WHERE sku = 'PKG-2CT-QR-FIELDMKTG';
UPDATE org_config.items SET stord_sku = 'Blood Orange Seeding Kit' WHERE sku = 'PKG-SEEDINGKIT-BO';
UPDATE org_config.items SET stord_sku = 'CASE - WATERMELON' WHERE sku = 'PKG-MASTERCASE';

-- Merch
UPDATE org_config.items SET stord_sku = 'MAGNA-BOTTLE-CLEAR' WHERE sku = 'MERCH-BOTTLE-CLEAR';
UPDATE org_config.items SET stord_sku = 'MAGNA-BOTTLE-BLACK' WHERE sku = 'MERCH-BOTTLE-BLACK';
UPDATE org_config.items SET stord_sku = 'MAGNA-WORLD-TEE-S' WHERE sku = 'MERCH-TEE-S';
UPDATE org_config.items SET stord_sku = 'MAGNA-WORLD-TEE-M' WHERE sku = 'MERCH-TEE-M';
UPDATE org_config.items SET stord_sku = 'MAGNA-WORLD-TEE-L' WHERE sku = 'MERCH-TEE-L';
UPDATE org_config.items SET stord_sku = 'MAGNA-WORLD-TEE-XL' WHERE sku = 'MERCH-TEE-XL';
UPDATE org_config.items SET stord_sku = 'MAGNA-WORLD-TEE-XXL' WHERE sku = 'MERCH-TEE-XXL';
UPDATE org_config.items SET stord_sku = 'MAGNA-WORLD-TEE-XS' WHERE sku = 'MERCH-TEE-XS';
UPDATE org_config.items SET stord_sku = 'IP- HAND TOWEL' WHERE sku = 'MERCH-TOWEL-HAND';
UPDATE org_config.items SET stord_sku = 'Run NYC - HAT' WHERE sku = 'MERCH-HAT-RUNNYC';
UPDATE org_config.items SET stord_sku = 'SWEAT IS SWEET - HAT' WHERE sku = 'MERCH-HAT-SWEATISFWEET';
UPDATE org_config.items SET stord_sku = 'Magna-Logo-Hat-Black' WHERE sku = 'MERCH-HAT-LOGOBLACK';
