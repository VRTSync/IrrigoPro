import { Badge } from "@/components/ui/badge";
import { LIFECYCLE_TINTS, type LifecycleStatus } from "@shared/lifecycle";

interface Props {
  status: LifecycleStatus;
}

export function EstimateListStatusBadge({ status }: Props) {
  const tint = LIFECYCLE_TINTS[status];
  return (
    <Badge
      variant="outline"
      className={`${tint.bg} ${tint.text} ${tint.border} ${
        status === "expired" ? "line-through" : ""
      }`}
      data-testid={`status-badge-${status}`}
    >
      {tint.label}
    </Badge>
  );
}
