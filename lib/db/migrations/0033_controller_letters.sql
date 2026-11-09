-- Controller Letters Slice 1: existing controllers require an on-site audit.
-- Do not rename or confirm any existing controller here.
ALTER TABLE irrigation_controllers
  ADD COLUMN IF NOT EXISTS letter_confirmed boolean NOT NULL DEFAULT false;
-- Retire the old runtime migration's hardening: swaps need a temporary NULL,
-- and inactive controllers must not reserve letters.
ALTER TABLE irrigation_controllers ALTER COLUMN letter DROP NOT NULL;
DROP INDEX IF EXISTS uniq_irr_ctrl_letter;
DROP INDEX IF EXISTS uniq_irr_ctrl_name;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_irr_ctrl_name_active
  ON irrigation_controllers (company_id, customer_id, branch_name, name)
  WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_irr_ctrl_letter_active
  ON irrigation_controllers (company_id, customer_id, branch_name, letter)
  WHERE is_active AND letter IS NOT NULL;
