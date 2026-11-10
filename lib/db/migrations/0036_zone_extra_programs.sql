CREATE TABLE irrigation_zone_extra_programs (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  zone_id integer NOT NULL,
  program_id integer NOT NULL,
  run_time_minutes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT irr_zone_extra_zone_fk FOREIGN KEY (zone_id) REFERENCES irrigation_profile_zones(id) ON DELETE CASCADE,
  CONSTRAINT irr_zone_extra_program_fk FOREIGN KEY (program_id) REFERENCES irrigation_programs(id) ON DELETE CASCADE,
  CONSTRAINT irr_zone_extra_runtime_check CHECK (run_time_minutes BETWEEN 0 AND 120)
);
CREATE UNIQUE INDEX uniq_irr_zone_extra_program ON irrigation_zone_extra_programs(zone_id, program_id);
CREATE INDEX irr_zone_extra_company_zone_idx ON irrigation_zone_extra_programs(company_id, zone_id);
