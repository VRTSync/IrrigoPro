import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Loader2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type GenerateWorkDescriptionResponse = {
  short_work_completed_description?: string;
  detailed_work_completed_description?: string;
  missing_info_warnings?: string[];
};

interface AiGenerateDescriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerated: (description: string) => void;
}

interface AiInputs {
  workPerformed: string;
  outcomeStatus: string;
  locationZone: string;
  issueFound: string;
  partsUsed: string;
  laborTime: string;
  followUpNeeded: string;
  technicianNotes: string;
}

const emptyInputs: AiInputs = {
  workPerformed: "",
  outcomeStatus: "",
  locationZone: "",
  issueFound: "",
  partsUsed: "",
  laborTime: "",
  followUpNeeded: "",
  technicianNotes: "",
};

export function AiGenerateDescriptionDialog({
  open,
  onOpenChange,
  onGenerated,
}: AiGenerateDescriptionDialogProps) {
  const [inputs, setInputs] = useState<AiInputs>(emptyInputs);
  const [isGenerating, setIsGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const { toast } = useToast();

  const updateInput = (field: keyof AiInputs, value: string) => {
    setInputs((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setWarnings([]);

    try {
      const result = (await apiRequest("/api/ai/generate-work-description", "POST", {
        ...inputs,
        entityType: "billing_sheet",
        entityId: null,
      })) as GenerateWorkDescriptionResponse;

      const short = result.short_work_completed_description || "";
      const warns: string[] = result.missing_info_warnings || [];

      setWarnings(warns);

      if (!short && warns.length > 0) {
        toast({
          title: "Missing required fields",
          description: "Please fill in Work Performed and Outcome/Status before generating.",
          variant: "destructive",
        });
        return;
      }

      if (short) {
        onGenerated(short);
        onOpenChange(false);
        setInputs(emptyInputs);
        setWarnings([]);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to generate description. Please try again.";
      if (msg.includes("OPENAI_API_KEY") || msg.includes("not configured")) {
        toast({
          title: "AI not configured",
          description: "An OpenAI API key is required. Please contact your administrator.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Generation failed",
          description: msg,
          variant: "destructive",
        });
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setInputs(emptyInputs);
      setWarnings([]);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-blue-700">
            <Sparkles className="w-5 h-5" />
            Generate Work Description with AI
          </DialogTitle>
          <DialogDescription>
            Enter the job facts below. AI will generate a professional work description — it never invents details not provided here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-sm font-medium text-gray-700">
              Work Performed <span className="text-red-500">*</span>
            </Label>
            <Textarea
              placeholder="e.g. Replaced broken head with Hunter PGP, adjusted spray pattern, tested coverage"
              value={inputs.workPerformed}
              onChange={(e) => updateInput("workPerformed", e.target.value)}
              className="min-h-[70px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-sm font-medium text-gray-700">
              Outcome / Current Status <span className="text-red-500">*</span>
            </Label>
            <Input
              placeholder="e.g. System fully operational, all zones tested and working"
              value={inputs.outcomeStatus}
              onChange={(e) => updateInput("outcomeStatus", e.target.value)}
            />
          </div>

          <Separator />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium text-gray-700">Location / Zone</Label>
              <Input
                placeholder="e.g. Front lawn, Zone 3"
                value={inputs.locationZone}
                onChange={(e) => updateInput("locationZone", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium text-gray-700">Issue Found</Label>
              <Input
                placeholder="e.g. Broken sprinkler head"
                value={inputs.issueFound}
                onChange={(e) => updateInput("issueFound", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium text-gray-700">Parts Used</Label>
              <Input
                placeholder="e.g. 2x Hunter PGP heads"
                value={inputs.partsUsed}
                onChange={(e) => updateInput("partsUsed", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium text-gray-700">Labor / Time</Label>
              <Input
                placeholder="e.g. 1.5 hours on site"
                value={inputs.laborTime}
                onChange={(e) => updateInput("laborTime", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium text-gray-700">Follow-Up Needed</Label>
              <Input
                placeholder="e.g. None, or: Return to check Zone 5"
                value={inputs.followUpNeeded}
                onChange={(e) => updateInput("followUpNeeded", e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-sm font-medium text-gray-700">Notes (Optional)</Label>
              <Input
                placeholder="e.g. Gate code changed"
                value={inputs.technicianNotes}
                onChange={(e) => updateInput("technicianNotes", e.target.value)}
              />
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map((warning, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200"
                >
                  <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-amber-800">{warning}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isGenerating}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
