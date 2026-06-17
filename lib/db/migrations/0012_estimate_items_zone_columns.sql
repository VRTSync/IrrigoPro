ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS controller_letter text;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS zone_number integer;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS issue_type text;
