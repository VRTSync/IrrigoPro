-- Migration 0024: IR- invoice numbers (CRM Billing Feed Slice 1b)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_invoice_number integer NOT NULL DEFAULT 1001;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS qb_doc_number_mismatch text;
