-- Additive ledger only. Older renames remain in their existing snapshots.
CREATE TABLE controller_letter_changes (
  id serial PRIMARY KEY,
  company_id integer NOT NULL,
  controller_id integer NOT NULL,
  customer_id integer NOT NULL,
  branch_name text NOT NULL DEFAULT '',
  from_letter text,
  to_letter text NOT NULL,
  source text NOT NULL,
  batch_id text,
  changed_at timestamp NOT NULL DEFAULT now(),
  changed_by_user_id integer,
  changed_by_name text NOT NULL,
  CONSTRAINT ctrl_letter_changes_source_check CHECK (source IN ('change','swap','reletter')),
  CONSTRAINT controller_letter_changes_company_id_companies_id_fk FOREIGN KEY (company_id) REFERENCES companies(id),
  CONSTRAINT ctrl_letter_changes_controller_fk FOREIGN KEY (controller_id) REFERENCES irrigation_controllers(id),
  CONSTRAINT controller_letter_changes_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT controller_letter_changes_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
);
CREATE INDEX ctrl_letter_changes_ctrl_idx ON controller_letter_changes (company_id, controller_id, changed_at);
CREATE INDEX ctrl_letter_changes_loc_idx ON controller_letter_changes (company_id, customer_id, branch_name);
