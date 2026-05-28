// Shared frontend types for the DB migration admin page.
// Mirror of the server-side types in api-server/src/lib/migrations/types.ts.

export type MigrationStatus =
  | { state: 'not_started' }
  | { state: 'partially_applied'; details: string }
  | { state: 'completed'; completedAt: string };

export type MigrationStep = {
  id: string;
  description: string;
};

export type MigrationStepResult = {
  id: string;
  status: 'success' | 'skipped' | 'failed' | 'running';
  durationMs: number;
  rowsAffected?: number;
  error?: string;
};

export type MigrationPreview = {
  steps: MigrationStep[];
  orphanRows: Record<string, number>;
  warnings: string[];
};

export type MigrationProgress = {
  jobId: string;
  migrationId: string;
  startedAt: string;
  state: 'running' | 'succeeded' | 'failed' | 'aborted';
  steps: MigrationStepResult[];
  finishedAt?: string;
  errorMessage?: string;
};

export type MigrationListItem = {
  id: string;
  title: string;
  description: string;
  status: MigrationStatus;
};
