/**
 * CombinedReviewPage — route wrapper for CombinedReviewSurface.
 *
 * Mounted at:
 *   /manager/wet-checks/:id        (all manager roles)
 *   /wet-checks/:id/review         (all manager roles)
 *
 * Reads the wet check ID from the URL and delegates rendering
 * to CombinedReviewSurface.
 */

import { useRoute } from "wouter";
import { CombinedReviewSurface } from "@/components/wet-check-review/CombinedReviewSurface";

export default function CombinedReviewPage() {
  const [matchManager, managerParams] = useRoute<{ id: string }>("/manager/wet-checks/:id");
  const [matchReview, reviewParams] = useRoute<{ id: string }>("/wet-checks/:id/review");

  const rawId = matchManager
    ? managerParams!.id
    : matchReview
    ? reviewParams!.id
    : null;

  const id = rawId != null ? parseInt(rawId) : NaN;

  if (!Number.isFinite(id)) {
    return (
      <div className="py-10 text-center text-sm text-gray-500" data-testid="crp-invalid-id">
        Invalid wet check ID.
      </div>
    );
  }

  return <CombinedReviewSurface wetCheckId={id} />;
}
