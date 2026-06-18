import type { MigrationDefinition } from './types';
import { companyIdColumnsMigration } from './company-id-columns';
import { reconcileBillingSheetInvoiceTotalsMigration } from './reconcile-billing-sheet-invoice-totals';

const REGISTRY = new Map<string, MigrationDefinition>([
  [companyIdColumnsMigration.id, companyIdColumnsMigration],
  [reconcileBillingSheetInvoiceTotalsMigration.id, reconcileBillingSheetInvoiceTotalsMigration],
]);

export function listMigrations(): MigrationDefinition[] {
  return Array.from(REGISTRY.values());
}

export function getMigration(id: string): MigrationDefinition | undefined {
  return REGISTRY.get(id);
}
