ALTER TABLE irrigation_controllers ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE irrigation_programs ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE irrigation_backflows ADD COLUMN IF NOT EXISTS client_id text;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_irr_ctrl_client_id ON irrigation_controllers(company_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_irr_prog_client_id ON irrigation_programs(company_id, client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_irr_backflow_client_id ON irrigation_backflows(company_id, client_id) WHERE client_id IS NOT NULL;
