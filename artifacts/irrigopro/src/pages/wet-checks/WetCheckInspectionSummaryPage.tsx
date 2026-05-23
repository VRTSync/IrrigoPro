import { useParams } from "wouter";
import { WetCheckInspectionSummary } from "./WetCheckInspectionSummary";

export default function WetCheckInspectionSummaryPage() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0", 10);
  return <WetCheckInspectionSummary id={id} />;
}
