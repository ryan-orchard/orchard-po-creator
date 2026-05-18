-- 019-sequences.sql
-- Replace app-side max-then-increment with proper Postgres sequences.
-- Eliminates the race condition where two concurrent writes could generate
-- the same PO/WO/RCP/SH number.

-- ── 1. Create sequences (idempotent) ──
CREATE SEQUENCE IF NOT EXISTS orchard.po_seq  AS BIGINT START WITH 10001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS orchard.wo_seq  AS BIGINT START WITH 10001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS orchard.rcp_seq AS BIGINT START WITH 10001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS orchard.sh_seq  AS BIGINT START WITH 10001 INCREMENT BY 1;

-- ── 2. Seed each sequence above the current max in the table ──
-- setval(seq, n) sets last_value = n so nextval() returns n+1.
SELECT setval(
  'orchard.po_seq',
  GREATEST(10000, COALESCE((
    SELECT MAX((regexp_match(po_number, '^PO-(\d+)$'))[1]::bigint)
    FROM orchard.purchase_orders
    WHERE po_number ~ '^PO-\d+$'
  ), 10000))
);

SELECT setval(
  'orchard.wo_seq',
  GREATEST(10000, COALESCE((
    SELECT MAX((regexp_match(wo_number, '^WO-(\d+)$'))[1]::bigint)
    FROM orchard.work_orders
    WHERE wo_number ~ '^WO-\d+$'
  ), 10000))
);

SELECT setval(
  'orchard.rcp_seq',
  GREATEST(10000, COALESCE((
    SELECT MAX((regexp_match(receipt_number, '^RCP-(\d+)$'))[1]::bigint)
    FROM orchard.receipts
    WHERE receipt_number ~ '^RCP-\d+$'
  ), 10000))
);

SELECT setval(
  'orchard.sh_seq',
  GREATEST(10000, COALESCE((
    SELECT MAX((regexp_match(shipment_number, '^SH-(\d+)$'))[1]::bigint)
    FROM orchard.shipments
    WHERE shipment_number ~ '^SH-\d+$'
  ), 10000))
);

-- ── 3. Grant usage to service_role ──
GRANT USAGE ON SEQUENCE
  orchard.po_seq,
  orchard.wo_seq,
  orchard.rcp_seq,
  orchard.sh_seq
TO service_role;

-- ── 4. RPC-callable function in public schema ──
-- The app calls db.rpc('next_sequence', { p_prefix: 'PO' }) which returns 'PO-10027'.
-- Lives in `public` so PostgREST exposes it; uses SECURITY DEFINER so it can read
-- sequences owned by the orchard schema.
CREATE OR REPLACE FUNCTION public.next_sequence(p_prefix text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = orchard, public
AS $$
DECLARE
  next_val bigint;
BEGIN
  CASE p_prefix
    WHEN 'PO'  THEN next_val := nextval('orchard.po_seq');
    WHEN 'WO'  THEN next_val := nextval('orchard.wo_seq');
    WHEN 'RCP' THEN next_val := nextval('orchard.rcp_seq');
    WHEN 'SH'  THEN next_val := nextval('orchard.sh_seq');
    ELSE RAISE EXCEPTION 'Unknown sequence prefix: %', p_prefix;
  END CASE;

  RETURN p_prefix || '-' || next_val::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_sequence(text) TO service_role, authenticated;

-- ── 5. Verify (output shows seeded values + a test call) ──
SELECT 'po_seq'  AS seq, last_value FROM orchard.po_seq
UNION ALL
SELECT 'wo_seq',  last_value FROM orchard.wo_seq
UNION ALL
SELECT 'rcp_seq', last_value FROM orchard.rcp_seq
UNION ALL
SELECT 'sh_seq',  last_value FROM orchard.sh_seq;
