import { useRoute, useLocation } from "wouter";
import { ControllerSelectionPage } from "./ControllerSelectionPage";

// Task #315 — read the pending branch from sessionStorage (written by
// CustomerPickerPage when the user selects a branch for a multi-branch
// customer). The value is consumed exactly once here and cleared so it
// doesn't bleed into a later navigation.
const SESSION_BRANCH_KEY = "wc_pending_branch";
function consumePendingBranch(): string | null {
  try {
    const v = sessionStorage.getItem(SESSION_BRANCH_KEY);
    sessionStorage.removeItem(SESSION_BRANCH_KEY);
    return v || null;
  } catch {
    return null;
  }
}

export default function NewWetCheckPage() {
  const [, params] = useRoute<{ customerId: string }>("/wet-checks/c/:customerId/new");
  const customerId = parseInt(params?.customerId ?? "0", 10);
  const branchName = consumePendingBranch();

  if (!customerId) return null;
  return <ControllerSelectionPage customerId={customerId} branchName={branchName} />;
}
