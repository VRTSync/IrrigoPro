// Slice 4a — Database migration registry types.

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
  status: 'success' | 'skipped' | 'failed';
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

export type ProgressEmitter = (event: {
  step: string;
  status: 'running' | 'success' | 'skipped' | 'failed';
  rowsAffected?: number;
  error?: string;
}) => void;

export type MigrationDefinition = {
  id: string;
  title: string;
  description: string;
  appSettingsKey: string;
  check(): Promise<MigrationStatus>;
  preview(): Promise<MigrationPreview>;
  run(emit: ProgressEmitter): Promise<MigrationStepResult[]>;
};
