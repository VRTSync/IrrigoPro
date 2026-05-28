import type { Express, Response } from 'express';
import { listMigrations, getMigration } from '../lib/migrations/registry';
import type { MigrationProgress } from '../lib/migrations/types';
import { randomUUID } from 'crypto';

// In-process job store. Migrations are short (< 30s) so persistence
// across server restarts is not required.
const JOBS = new Map<string, MigrationProgress>();

function requireSuperAdmin(req: any, res: Response): boolean {
  if (req.authenticatedUserRole !== 'super_admin') {
    res.status(403).json({ message: 'Super admin only' });
    return false;
  }
  return true;
}

export function registerAdminMigrationsRoutes(app: Express, requireAuthentication: any) {
  // GET /api/admin/migrations
  app.get('/api/admin/migrations', requireAuthentication, async (req: any, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const defs = listMigrations();
    const rows = await Promise.all(defs.map(async (d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      status: await d.check(),
    })));
    res.json(rows);
  });

  // GET /api/admin/migrations/:id/preview
  app.get('/api/admin/migrations/:id/preview', requireAuthentication, async (req: any, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const d = getMigration(req.params.id);
    if (!d) { res.status(404).json({ message: 'Migration not found' }); return; }
    const preview = await d.preview();
    res.json(preview);
  });

  // POST /api/admin/migrations/:id/run
  app.post('/api/admin/migrations/:id/run', requireAuthentication, async (req: any, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const d = getMigration(req.params.id);
    if (!d) { res.status(404).json({ message: 'Migration not found' }); return; }
    const jobId = randomUUID();
    const progress: MigrationProgress = {
      jobId,
      migrationId: d.id,
      startedAt: new Date().toISOString(),
      state: 'running',
      steps: [],
    };
    JOBS.set(jobId, progress);
    // Fire-and-forget the runner; the client polls /status.
    void (async () => {
      try {
        const results = await d.run((event) => {
          // Mirror live events into the job's step list.
          const existing = progress.steps.findIndex((s) => s.id === event.step);
          if (existing >= 0) {
            progress.steps[existing] = {
              ...progress.steps[existing],
              status: event.status as MigrationProgress['steps'][number]['status'],
              error: event.error,
            };
          } else {
            progress.steps.push({
              id: event.step,
              status: event.status as MigrationProgress['steps'][number]['status'],
              durationMs: 0,
              error: event.error,
            });
          }
        });
        progress.steps = results;
        progress.state = results.some((r) => r.status === 'failed') ? 'failed' : 'succeeded';
        progress.finishedAt = new Date().toISOString();
      } catch (err: any) {
        progress.state = 'failed';
        progress.errorMessage = err?.message ?? String(err);
        progress.finishedAt = new Date().toISOString();
      }
    })();
    res.json({ jobId });
  });

  // GET /api/admin/migrations/:id/status?jobId=...
  app.get('/api/admin/migrations/:id/status', requireAuthentication, async (req: any, res) => {
    if (!requireSuperAdmin(req, res)) return;
    // Validate migration id first (404 on unknown migration, not just on missing job).
    const d = getMigration(req.params.id);
    if (!d) { res.status(404).json({ message: 'Migration not found' }); return; }
    const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : '';
    const job = JOBS.get(jobId);
    if (!job) { res.status(404).json({ message: 'Job not found' }); return; }
    // Guard: the job must belong to this migration (prevents cross-migration status leakage).
    if (job.migrationId !== req.params.id) {
      res.status(404).json({ message: 'Job not found for this migration' });
      return;
    }
    res.json(job);
  });
}
