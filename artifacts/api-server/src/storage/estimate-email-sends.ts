import { and, eq, isNull } from "drizzle-orm";
import { db, estimateEmailSendClaims, estimates, type Estimate } from "@workspace/db";
import { computeLifecycleStatus } from "@workspace/shared";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SendMode = "first" | "redelivery" | "resend";

function matchesSendState(estimate: Estimate, mode: SendMode) {
  if (mode === "first") {
    return estimate.status === "pending" &&
      (estimate.internalStatus === "pending_approval" || estimate.internalStatus === "approved_internal");
  }
  return estimate.internalStatus === "sent_to_customer" && estimate.lifecycle === "sent" &&
    (estimate.status === "pending" || (mode === "resend" && estimate.status === "expired"));
}

function claimScope(estimateId: number, companyId: number) {
  return and(eq(estimateEmailSendClaims.estimateId, estimateId), eq(estimateEmailSendClaims.companyId, companyId));
}

function estimateScope(id: number, companyId: number) {
  return and(eq(estimates.id, id), eq(estimates.companyId, companyId), isNull(estimates.deletedAt));
}

function lockEstimate(tx: Transaction, id: number, companyId: number) {
  // Only hold a lock for database work. The persisted claim, not this lock,
  // guards the external provider call (including across server restarts).
  return tx.select().from(estimates).where(estimateScope(id, companyId)).for("update");
}

export async function claimEstimateEmailSend(
  snapshot: Estimate,
  attemptId: string,
  mode: SendMode,
): Promise<"claimed" | "blocked" | "changed"> {
  return db.transaction(async (tx) => {
    const [current] = await lockEstimate(tx, snapshot.id, snapshot.companyId);
    if (!current) return "changed";
    if (
      !matchesSendState(current, mode) ||
      (mode !== "first" && computeLifecycleStatus(current) !== (mode === "resend" ? "expired" : "sent")) ||
      current.status !== snapshot.status ||
      current.internalStatus !== snapshot.internalStatus ||
      current.lifecycle !== snapshot.lifecycle ||
      current.updatedAt.getTime() !== snapshot.updatedAt.getTime() ||
      current.estimateDate.getTime() !== snapshot.estimateDate.getTime() ||
      current.approvalToken !== snapshot.approvalToken ||
      current.tokenExpiresAt?.getTime() !== snapshot.tokenExpiresAt?.getTime() ||
      current.approvalSentAt?.getTime() !== snapshot.approvalSentAt?.getTime()
    ) return "changed";

    const [claimed] = await tx.insert(estimateEmailSendClaims)
      .values({ estimateId: snapshot.id, companyId: snapshot.companyId, attemptId })
      .onConflictDoNothing({ target: estimateEmailSendClaims.estimateId })
      .returning({ attemptId: estimateEmailSendClaims.attemptId });
    return claimed ? "claimed" : "blocked";
  });
}

export async function releaseEstimateEmailSend(id: number, companyId: number, attemptId: string): Promise<void> {
  await db.delete(estimateEmailSendClaims)
    .where(and(claimScope(id, companyId), eq(estimateEmailSendClaims.attemptId, attemptId)));
}

export async function markEstimateSentToCustomer(
  id: number,
  args: {
    companyId: number;
    approvalToken: string;
    tokenExpiresAt: Date;
    approvalSentAt: Date;
    newEstimateDate: Date | null;
    isResend: boolean;
    isSentRedelivery?: boolean;
    previousApprovalToken?: string | null;
    sentToEmail?: string;
    deliveryAttemptId?: string;
  },
): Promise<Estimate | undefined> {
  return db.transaction(async (tx) => {
    const [current] = await lockEstimate(tx, id, args.companyId);
    if (!current) return undefined;
    const [claim] = await tx.select({ attemptId: estimateEmailSendClaims.attemptId })
      .from(estimateEmailSendClaims).where(claimScope(id, args.companyId));
    // Manual mark-sent also takes the estimate lock and cannot invalidate
    // the approval link from an in-flight or unconfirmed delivery.
    if (claim?.attemptId !== args.deliveryAttemptId) return undefined;

    const mode = args.isResend ? "resend" : args.isSentRedelivery ? "redelivery" : "first";
    // Recheck state under the same row lock without re-evaluating expiry:
    // customer approval must not be undone, but crossing midnight in the
    // mailer's call shouldn't cause us to discard an accepted send.
    if (!matchesSendState(current, mode) ||
        (mode !== "first" && current.approvalToken !== (args.previousApprovalToken ?? null))) return undefined;

    const [updated] = await tx.update(estimates).set({
      approvalToken: args.approvalToken,
      tokenExpiresAt: args.tokenExpiresAt,
      approvalSentAt: args.approvalSentAt,
      internalStatus: "sent_to_customer",
      lifecycle: "sent",
      ...(args.sentToEmail ? { sentToEmail: args.sentToEmail } : {}),
      // Reset a legacy persisted 'expired' status so the new link can be used.
      ...(args.isResend ? { status: "pending" } : {}),
      ...(args.newEstimateDate ? { estimateDate: args.newEstimateDate } : {}),
    }).where(estimateScope(id, args.companyId)).returning();
    if (!updated) return undefined;
    if (args.deliveryAttemptId) {
      await tx.delete(estimateEmailSendClaims).where(and(
        claimScope(id, args.companyId), eq(estimateEmailSendClaims.attemptId, args.deliveryAttemptId),
      ));
    }
    return { ...updated, lifecycleStatus: computeLifecycleStatus(updated) };
  });
}
