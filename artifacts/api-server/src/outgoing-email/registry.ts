import { createInvoiceEmailHandler } from "./invoice-handler";
import { createEstimateEmailHandler } from "./estimate-handlers";
import { storage } from "../storage";
import type { EstimateRouteDeps } from "../routes/estimate-routes";
import { createReminderEmailHandler } from "./reminder-handler";
import { createReportEmailHandlers } from "./report-handlers";
import type { ReminderCore } from "../routes/invoice-reminder-routes";
import type { OutgoingEmailHandler } from "./types";

export function createOutgoingEmailHandlers(
  core: ReminderCore,
  recordLifecycleAudit?: EstimateRouteDeps["recordLifecycleAudit"],
): OutgoingEmailHandler<any>[] {
  return [
    createInvoiceEmailHandler(),
    createEstimateEmailHandler("estimate", { storage, recordLifecycleAudit }),
    createEstimateEmailHandler("estimate_resend", { storage, recordLifecycleAudit }),
    createReminderEmailHandler(core),
    ...createReportEmailHandlers(),
  ];
}
