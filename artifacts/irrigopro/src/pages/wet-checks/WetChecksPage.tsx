import { useRoute } from "wouter";
import { WetCheckList } from "./WetCheckList";
import { WetCheckDetail } from "./WetCheckDetail";

// ─── Route helpers ─────────────────────────────────────────────────────────────
//
// /wet-checks/c/:param is shared by two distinct uses:
//   1. Offline wet-check clientId (UUID, e.g. "550e8400-…") — existing offline sync path
//   2. Customer Hub navigation (numeric customerId, e.g. "42") — new Slice 2 route
//
// We distinguish by checking whether the param is purely numeric.
// Numeric → customerId, routed to the Customer Hub (Slice 2 will replace this stub).
// UUID    → offline clientId, routed to WetCheckDetail as before.

function isNumericId(s: string): boolean {
  return /^\d+$/.test(s);
}

// ─── Page entry ───────────────────────────────────────────────────────────────

export default function WetChecksPage() {
  const [matchByClientId, clientIdParams] = useRoute<{ clientId: string }>("/wet-checks/c/:clientId");
  const [matchDetail, params] = useRoute<{ id: string }>("/wet-checks/:id");

  if (matchByClientId) {
    const param = clientIdParams!.clientId;
    if (isNumericId(param)) {
      // Customer Hub — Slice 2 will replace this route with the full hub.
      // For now, fall through to the wet-check list so the route doesn't crash.
      return <WetCheckList />;
    }
    // UUID offline clientId — existing offline wet check detail flow.
    return <WetCheckDetail clientId={param} />;
  }

  if (matchDetail) return <WetCheckDetail id={parseInt(params!.id)} />;
  return <WetCheckList />;
}
