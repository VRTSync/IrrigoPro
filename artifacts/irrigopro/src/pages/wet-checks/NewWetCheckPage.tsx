import { useRoute } from "wouter";
import { ControllerSelectionPage } from "./ControllerSelectionPage";

export default function NewWetCheckPage() {
  const [, params] = useRoute<{ customerId: string }>("/wet-checks/c/:customerId/new");
  const customerId = parseInt(params?.customerId ?? "0", 10);

  if (!customerId) return null;
  return <ControllerSelectionPage customerId={customerId} />;
}
