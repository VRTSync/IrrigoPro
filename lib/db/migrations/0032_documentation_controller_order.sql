-- Presentation only. Existing controller identity, content and verification are untouched.
ALTER TABLE irrigation_site_documentation
  ADD COLUMN IF NOT EXISTS controller_order jsonb NOT NULL DEFAULT '[]'::jsonb;
