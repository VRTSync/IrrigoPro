import type { MigrationDefinition } from './types';
import { companyIdColumnsMigration } from './company-id-columns';

const REGISTRY = new Map<string, MigrationDefinition>([
  [companyIdColumnsMigration.id, companyIdColumnsMigration],
]);

export function listMigrations(): MigrationDefinition[] {
  return Array.from(REGISTRY.values());
}

export function getMigration(id: string): MigrationDefinition | undefined {
  return REGISTRY.get(id);
}
