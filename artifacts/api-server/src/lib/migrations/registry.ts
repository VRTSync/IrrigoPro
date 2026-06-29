import type { MigrationDefinition } from './types';
import { companyIdColumnsMigration } from './company-id-columns';
import { reconcileBillingSheetInvoiceTotalsMigration } from './reconcile-billing-sheet-invoice-totals';
import { workOrderZonesMigration } from './work-order-zones';
import { renumberEstimatesMigration } from './renumber-estimates';
import { reconcileFindingDispositionMigration } from './reconcile-finding-disposition';
import { trimPhantomZonesMigration } from './trim-phantom-zones';
import { importIrrigationProfileMigration } from './import-irrigation-profile-from-property-controllers';

const REGISTRY = new Map<string, MigrationDefinition>([
  [companyIdColumnsMigration.id, companyIdColumnsMigration],
  [reconcileBillingSheetInvoiceTotalsMigration.id, reconcileBillingSheetInvoiceTotalsMigration],
  [workOrderZonesMigration.id, workOrderZonesMigration],
  [renumberEstimatesMigration.id, renumberEstimatesMigration],
  [reconcileFindingDispositionMigration.id, reconcileFindingDispositionMigration],
  [trimPhantomZonesMigration.id, trimPhantomZonesMigration],
  [importIrrigationProfileMigration.id, importIrrigationProfileMigration],
]);

export function listMigrations(): MigrationDefinition[] {
  return Array.from(REGISTRY.values());
}

export function getMigration(id: string): MigrationDefinition | undefined {
  return REGISTRY.get(id);
}
