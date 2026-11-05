ALTER TABLE customers ADD COLUMN IF NOT EXISTS qb_not_in_quickbooks_at timestamptz;
CREATE TABLE IF NOT EXISTS customer_sync_review (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  kind text NOT NULL CONSTRAINT customer_sync_review_kind_check CHECK (kind IN ('possible_duplicate', 'sub_customer')),
  qb_customer_id text NOT NULL,
  qb_name text,
  qb_address text,
  qb_parent_id text,
  candidate_customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CONSTRAINT customer_sync_review_status_check CHECK (status IN ('open','linked','created','dismissed')),
  resolved_by_user_id integer REFERENCES users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Upgrade an already-applied development copy as well as fresh installations.
-- A candidate is only a hint: deleting it must not destroy or block a review.
DO $$
DECLARE
  candidate_fk record;
BEGIN
  FOR candidate_fk IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    JOIN pg_attribute column_row
      ON column_row.attrelid = constraint_row.conrelid
      AND constraint_row.conkey = ARRAY[column_row.attnum]
    WHERE constraint_row.conrelid = 'customer_sync_review'::regclass
      AND constraint_row.contype = 'f'
      AND column_row.attname = 'candidate_customer_id'
      AND constraint_row.confdeltype <> 'n'
  LOOP
    EXECUTE format('ALTER TABLE customer_sync_review DROP CONSTRAINT %I', candidate_fk.conname);
    EXECUTE format('ALTER TABLE customer_sync_review ADD CONSTRAINT %I FOREIGN KEY (candidate_customer_id) REFERENCES customers(id) ON DELETE SET NULL', candidate_fk.conname);
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS customer_sync_review_company_status_idx ON customer_sync_review(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS customer_sync_review_active_qb_id_unique
  ON customer_sync_review(company_id, qb_customer_id) WHERE status IN ('open','dismissed');
