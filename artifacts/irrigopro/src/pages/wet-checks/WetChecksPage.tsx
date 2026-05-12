import { useRoute } from "wouter";
import { WetCheckList } from "./WetCheckList";
import { WetCheckDetail } from "./WetCheckDetail";

// ─── Page entry ───────────────────────────────────────────────────────────────

export default function WetChecksPage() {
  const [matchByClientId, clientIdParams] = useRoute<{ clientId: string }>("/wet-checks/c/:clientId");
  const [matchDetail, params] = useRoute<{ id: string }>("/wet-checks/:id");
  if (matchByClientId) return <WetCheckDetail clientId={clientIdParams!.clientId} />;
  if (matchDetail) return <WetCheckDetail id={parseInt(params!.id)} />;
  return <WetCheckList />;
}
