// Wraps a backend operation and emits an app_event with latency +
// outcome. Sink is fire-and-forget; the wrapped fn's result/throw is
// passed through unchanged.

type SinkFn = (evt: TelemetryEvent) => void;

export type TelemetryEvent = {
  source: "api" | "worker" | "integration";
  component: string; // e.g. "photo.upload.finalize", "qb.invoice.create"
  type: "metric" | "error";
  severity: "info" | "warning" | "error" | "fatal";
  durationMs: number;
  ok: boolean;
  statusCode?: number | null;
  errorName?: string | null;
  errorMessage?: string | null;
  context?: Record<string, unknown> | null;
};

let sink: SinkFn | null = null;

export function setTelemetrySink(fn: SinkFn): void {
  sink = fn;
}

export async function withTelemetry<T>(
  options: {
    source: TelemetryEvent["source"];
    component: string;
    context?: Record<string, unknown>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const out = await fn();
    emit({
      source: options.source,
      component: options.component,
      type: "metric",
      severity: "info",
      durationMs: Date.now() - start,
      ok: true,
      context: options.context ?? null,
    });
    return out;
  } catch (err: unknown) {
    const e = err as { status?: unknown; name?: unknown; message?: unknown };
    // Emit as metric (with severity=error in payload) so integration
    // failures show up in operational dashboards but stay out of the
    // Crashes view, which filters by type IN (error, unhandled_rejection).
    emit({
      source: options.source,
      component: options.component,
      type: "metric",
      severity: "error",
      durationMs: Date.now() - start,
      ok: false,
      statusCode: typeof e.status === "number" ? e.status : null,
      errorName: typeof e.name === "string" ? e.name : "Error",
      errorMessage:
        typeof e.message === "string" ? e.message : String(err),
      context: options.context ?? null,
    });
    throw err;
  }
}

function emit(evt: TelemetryEvent): void {
  if (!sink) return;
  try { sink(evt); } catch { /* swallow */ }
}
