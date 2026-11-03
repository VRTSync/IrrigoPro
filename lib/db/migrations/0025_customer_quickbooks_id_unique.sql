-- Migration 0025: one IrrigoPro customer per QuickBooks customer, per company
-- (Customer Records Slice 1). Refuses to run while duplicates exist; never edits customers.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM customers
    WHERE quickbooks_id IS NOT NULL AND quickbooks_id <> ''
    GROUP BY company_id, quickbooks_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'customers has duplicate (company_id, quickbooks_id) rows; resolve them before applying 0025';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS customers_company_quickbooks_id_unique
  ON customers (company_id, quickbooks_id)
  WHERE quickbooks_id IS NOT NULL AND quickbooks_id <> '';
