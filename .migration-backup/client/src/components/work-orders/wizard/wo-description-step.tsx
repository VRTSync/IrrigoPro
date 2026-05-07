import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";
import type { WorkLocation } from "./wo-location-step";
import { WizardSummaryStrip } from "./wo-summary-strip";

export interface DescriptionStepValue {
  description: string;
}

interface Props {
  value: DescriptionStepValue;
  onChange: (next: DescriptionStepValue) => void;
  customerName: string;
  branchName: string;
  pinnedLocation: WorkLocation | null;
  onEditPin: () => void;
  onBack: () => void;
  onContinue: () => void;
}

export function WoDescriptionStep({
  value,
  onChange,
  customerName,
  branchName,
  pinnedLocation,
  onEditPin,
  onBack,
  onContinue,
}: Props) {
  const canContinue = value.description.trim().length > 0;

  return (
    <div className="space-y-4">
      <WizardSummaryStrip
        customerName={customerName}
        branchName={branchName}
        pinnedLocation={pinnedLocation}
        onEditPin={onEditPin}
      />

      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="bg-blue-50 p-2 rounded-md">
              <FileText className="w-4 h-4 text-blue-600" />
            </div>
            <h2 className="text-base font-semibold text-gray-900">Work Description</h2>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wo-wizard-description" className="text-sm">
              Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="wo-wizard-description"
              autoFocus
              value={value.description}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
              placeholder="Describe the work to be performed..."
              className="min-h-[160px]"
            />
            <p className="text-xs text-gray-500">
              What needs to be done? Be specific so the tech arrives prepared.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="hidden sm:flex justify-between gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onBack}>← Back</Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={!canContinue}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
