import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export interface AiInputs {
  locationZone: string;
  issueFound: string;
  workPerformed: string;
  partsUsed: string;
  laborTime: string;
  outcomeStatus: string;
  followUpNeeded: string;
  technicianNotes: string;
}

export interface AiOutputs {
  shortDescription: string;
  detailedDescription: string;
}

interface GenerateDescriptionPanelProps {
  entityType: "billing_sheet" | "work_order";
  entityId?: number;
  onOutputChange?: (outputs: AiOutputs, inputs: AiInputs) => void;
}

const emptyInputs: AiInputs = {
  locationZone: "",
  issueFound: "",
  workPerformed: "",
  partsUsed: "",
  laborTime: "",
  outcomeStatus: "",
  followUpNeeded: "",
  technicianNotes: "",
};

export function GenerateDescriptionPanel({
  entityType,
  entityId,
  onOutputChange,
}: GenerateDescriptionPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputs, setInputs] = useState<AiInputs>(emptyInputs);
  const [shortDescription, setShortDescription] = useState("");
  const [detailedDescription, setDetailedDescription] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const { toast } = useToast();

  const updateInput = (field: keyof AiInputs, value: string) => {
    setInputs((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    setWarnings([]);

    try {
      const result: any = await apiRequest("/api/ai/generate-work-description", "POST", {
        ...inputs,
        entityType,
        entityId: entityId ?? null,
      });

      const short = result.short_work_completed_description || "";
      const detailed = result.detailed_work_completed_description || "";
      const warns: string[] = result.missing_info_warnings || [];

      setShortDescription(short);
      setDetailedDescription(detailed);
      setWarnings(warns);
      setHasGenerated(true);

      if (onOutputChange) {
        onOutputChange(
          { shortDescription: short, detailedDescription: detailed },
          inputs
        );
      }

      if (warns.length > 0 && !short && !detailed) {
        toast({
          title: "Missing required fields",
          description: "Please fill in Work Performed and Outcome/Status before generating.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      const msg = error?.message || "Failed to generate description. Please try again.";
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

  const handleShortChange = (val: string) => {
    setShortDescription(val);
    if (onOutputChange) {
      onOutputChange({ shortDescription: val, detailedDescription }, inputs);
    }
  };

  const handleDetailedChange = (val: string) => {
    setDetailedDescription(val);
    if (onOutputChange) {
      onOutputChange({ shortDescription, detailedDescription: val }, inputs);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-2 border-dashed border-blue-200 bg-blue-50/30">
        <CardHeader className="pb-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-between w-full text-left"
            >
              <CardTitle className="text-lg flex items-center gap-2 text-blue-700">
                <Sparkles className="w-5 h-5" />
                AI Description Generator
                <Badge variant="outline" className="text-xs font-normal text-blue-600 border-blue-300 ml-1">
                  Optional
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                {hasGenerated && (
                  <Badge className="bg-green-100 text-green-700 text-xs">
                    Generated
                  </Badge>
                )}
                {isOpen ? (
                  <ChevronUp className="w-4 h-4 text-blue-600" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-blue-600" />
                )}
              </div>
            </button>
          </CollapsibleTrigger>
          {!isOpen && (
            <p className="text-sm text-blue-600 mt-1">
              Click to expand and generate a professional work-completed description using AI.
            </p>
          )}
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            <p className="text-sm text-gray-600 bg-white border border-blue-100 rounded-lg p-3">
              Enter structured job facts below. AI converts them into polished descriptions — it never invents details not provided here.
              These descriptions are stored alongside your existing billing fields and do not replace any parts, labor, or other structured data.
            </p>

            <Separator />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-sm font-medium text-gray-700">Location / Zone</Label>
                <Input
                  placeholder="e.g. Front lawn, Zone 3, Controller B"
                  value={inputs.locationZone}
                  onChange={(e) => updateInput("locationZone", e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-sm font-medium text-gray-700">Issue Found</Label>
                <Input
                  placeholder="e.g. Broken sprinkler head, clogged drip line"
                  value={inputs.issueFound}
                  onChange={(e) => updateInput("issueFound", e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label className="text-sm font-medium text-gray-700">
                  Work Performed <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  placeholder="e.g. Replaced broken head with Hunter PGP, adjusted spray pattern, tested coverage"
                  value={inputs.workPerformed}
                  onChange={(e) => updateInput("workPerformed", e.target.value)}
                  className="bg-white min-h-[70px]"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-sm font-medium text-gray-700">Parts Used</Label>
                <Input
                  placeholder="e.g. 2x Hunter PGP heads, 1x 1-inch coupler"
                  value={inputs.partsUsed}
                  onChange={(e) => updateInput("partsUsed", e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-sm font-medium text-gray-700">Labor / Time</Label>
                <Input
                  placeholder="e.g. 1.5 hours on site"
                  value={inputs.laborTime}
                  onChange={(e) => updateInput("laborTime", e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1 md:col-span-2">
                <Label className="text-sm font-medium text-gray-700">
                  Outcome / Current Status <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="e.g. System fully operational, all zones tested and working"
                  value={inputs.outcomeStatus}
                  onChange={(e) => updateInput("outcomeStatus", e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-sm font-medium text-gray-700">Follow-Up Needed</Label>
                <Input
                  placeholder="e.g. None, or: Return to check Zone 5 pressure next visit"
                  value={inputs.followUpNeeded}
                  onChange={(e) => updateInput("followUpNeeded", e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-sm font-medium text-gray-700">Technician Notes (Optional)</Label>
                <Input
                  placeholder="e.g. Gate code changed, see customer notes"
                  value={inputs.technicianNotes}
                  onChange={(e) => updateInput("technicianNotes", e.target.value)}
                  className="bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end">
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
                ) : hasGenerated ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Regenerate
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Description
                  </>
                )}
              </Button>
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

            {hasGenerated && (shortDescription || detailedDescription) && (
              <>
                <Separator />
                <div className="space-y-4 bg-white rounded-lg border border-blue-100 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <span className="text-sm font-semibold text-blue-700">Generated Output</span>
                    <span className="text-xs text-gray-500">(edit before saving)</span>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-gray-700">Short Description</Label>
                    <Textarea
                      value={shortDescription}
                      onChange={(e) => handleShortChange(e.target.value)}
                      className="min-h-[60px] bg-gray-50"
                      placeholder="Short work-completed description..."
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-gray-700">Detailed Description</Label>
                    <Textarea
                      value={detailedDescription}
                      onChange={(e) => handleDetailedChange(e.target.value)}
                      className="min-h-[100px] bg-gray-50"
                      placeholder="Detailed work-completed description..."
                    />
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
