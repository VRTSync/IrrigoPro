import { useEffect } from "react";
import { clearSessionAndLogout } from "@/lib/queryClient";

// Every role switches accounts by signing out and signing in as the other
// account. The server identifies users by session only, so rewriting the
// stored user would show one role's screens while requests run as another.
// Super admin impersonation lives in App Health (server-signed, audited).
export default function SwitchUser() {
  useEffect(() => { clearSessionAndLogout(); }, []);
  return <p role="status" className="mx-auto max-w-[480px] p-4 text-sm">Signing out to switch accounts…</p>;
}
