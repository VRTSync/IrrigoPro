-- Mission 6 — Aspire Integration: customers.external_contacts column
--
-- Adds a nullable jsonb column to the customers table to store Aspire contact
-- records keyed to a customer account. Aspire contacts have no dedicated
-- IrrigoPro table; this column holds them as a JSON array so billing and
-- field-tech views can access them without a schema join.
--
-- Column shape (JSON array):
--   [{ aspireId, name, email?, phone?, role?, isPrimary? }, ...]
--
-- This column is written by syncContacts() and never modified by the
-- IrrigoPro application directly. Existing customers receive NULL (no contacts
-- yet) — this is intentional; NULL means "not yet synced" not "has no contacts".
--
-- Safe to re-run: ALTER TABLE ... ADD COLUMN IF NOT EXISTS.

ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "external_contacts" jsonb;
