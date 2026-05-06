#!/bin/bash
set -e
npm install

# Pre-create photo_late_additions so drizzle-kit doesn't trigger an interactive
# rename-detection prompt on `db:push` (stdin is closed in CI; arrow-key
# prompts hang). Idempotent — safe to re-run.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS photo_late_additions (
  id serial PRIMARY KEY,
  ticket_type text NOT NULL,
  ticket_id integer NOT NULL,
  ticket_number text,
  ticket_status_at_addition text,
  invoice_id_at_addition integer,
  company_id integer REFERENCES companies(id),
  actor_user_id integer REFERENCES users(id),
  actor_name text,
  actor_role text,
  prior_photos text[] NOT NULL DEFAULT ARRAY[]::text[],
  new_photos text[] NOT NULL DEFAULT ARRAY[]::text[],
  added_photos text[] NOT NULL DEFAULT ARRAY[]::text[],
  removed_photos text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photo_late_additions_ticket_idx
  ON photo_late_additions (ticket_type, ticket_id);
SQL

npm run db:push -- --force
