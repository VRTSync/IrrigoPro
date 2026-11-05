ALTER TABLE customers ADD COLUMN IF NOT EXISTS hidden_by_quickbooks boolean NOT NULL DEFAULT false;
