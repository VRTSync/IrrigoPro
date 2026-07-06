import type { MigrationDefinition } from './types';
import { reconcileBillingSheetInvoiceTotalsMigration } from './reconcile-billing-sheet-invoice-totals';
import { repairWoMatchEstimateMigration } from './repair-wo-match-estimate';

const REGISTRY = new Map<string, MigrationDefinition>([
  [reconcileBillingSheetInvoiceTotalsMigration.id, reconcileBillingSheetInvoiceTotalsMigration],
  [repairWoMatchEstimateMigration.id, repairWoMatchEstimateMigration],
]);

export function listMigrations(): MigrationDefinition[] {
  return Array.from(REGISTRY.values());
}

export function getMigration(id: string): MigrationDefinition | undefined {
  return REGISTRY.get(id);
}
