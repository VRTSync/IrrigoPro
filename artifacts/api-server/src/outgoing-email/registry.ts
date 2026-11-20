import { createInvoiceEmailHandler } from "./invoice-handler";
import { createEstimateEmailHandler } from "./estimate-handlers";
import { storage } from "../storage";
import type { EstimateRouteDeps } from "../routes/estimate-routes";
import type { OutgoingEmailHandler } from "./types";

export function createOutgoingEmailHandlers(recordLifecycleAudit?: EstimateRouteDeps["recordLifecycleAudit"]): OutgoingEmailHandler<any>[] {
  return [
    createInvoiceEmailHandler(),
    createEstimateEmailHandler("estimate", { storage, recordLifecycleAudit }),
    createEstimateEmailHandler("estimate_resend", { storage, recordLifecycleAudit }),
  ];
}
