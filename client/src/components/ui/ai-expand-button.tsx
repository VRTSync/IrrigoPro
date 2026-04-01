import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface AiExpandButtonProps {
  getValue: () => string;
  onSuggestion: (suggestion: string) => void;
  className?: string;
}

export function AiExpandButton({ getValue, onSuggestion, className }: AiExpandButtonProps) {
  const [isExpanding, setIsExpanding] = useState(false);
  const { toast } = useToast();

  const handleExpand = async () => {
    const raw = getValue().trim();
    if (!raw) return;
    setIsExpanding(true);
    try {
      const result = await apiRequest("/api/ai/expand-description", "POST", { rawDescription: raw }) as { expanded: string };
      if (result?.expanded) {
        onSuggestion(result.expanded);
      } else {
        toast({ title: "No suggestion returned", description: "Try adding more detail to your description.", variant: "destructive" });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to generate. Please try again.";
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setIsExpanding(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleExpand}
      disabled={isExpanding || !getValue().trim()}
      className={`h-6 px-2 text-xs gap-1 text-blue-600 border-blue-200 hover:bg-blue-50 disabled:opacity-40 ${className ?? ""}`}
    >
      {isExpanding ? (
        <>
          <Loader2 className="w-3 h-3 animate-spin" />
          Enhancing...
        </>
      ) : (
        <>
          <Sparkles className="w-3 h-3" />
          Enhance with AI
        </>
      )}
    </Button>
  );
}

interface AiSuggestionCardProps {
  suggestion: string | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export function AiSuggestionCard({ suggestion, onAccept, onDismiss }: AiSuggestionCardProps) {
  if (!suggestion) return null;
  return (
    <div className="mt-2 p-3 rounded-lg border border-blue-200 bg-blue-50 space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
        <span className="text-xs font-semibold text-blue-700">AI Suggestion</span>
      </div>
      <p className="text-sm text-gray-800 leading-relaxed">{suggestion}</p>
      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          onClick={onAccept}
          className="h-7 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1"
        >
          <Check className="w-3 h-3" />
          Use this
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDismiss}
          className="h-7 px-3 text-xs gap-1"
        >
          <X className="w-3 h-3" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
