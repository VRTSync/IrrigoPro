-- Migration 0026: customer records lock (Customer Records Slice 3a)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS customer_records_locked boolean NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS customer_records_system_name text;
