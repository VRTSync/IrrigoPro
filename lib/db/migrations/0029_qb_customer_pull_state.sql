ALTER TABLE quickbooks_integration ADD COLUMN IF NOT EXISTS customer_pull_last_attempt_at timestamptz;
ALTER TABLE quickbooks_integration ADD COLUMN IF NOT EXISTS customer_pull_last_success_at timestamptz;
ALTER TABLE quickbooks_integration ADD COLUMN IF NOT EXISTS customer_pull_last_error text;
ALTER TABLE quickbooks_integration ADD COLUMN IF NOT EXISTS customer_pull_last_summary jsonb;
