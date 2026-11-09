import type { ReactNode } from "react";
import { ArrowLeft, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WizardHeader } from "@/components/wizard-shared/wizard-header";
import { cn } from "@/lib/utils";

export interface DocFrameFlow {
  mode: "new" | "edit";
  recordIdentifier: string;
  currentStep: number;
  stepTitles: string[];
  onSaveExit: () => void;
  busy?: boolean;
}

export interface DocFrameProps {
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  flow?: DocFrameFlow;
  children: ReactNode;
  /** Disables every control in the content while a save is in flight. */
  contentDisabled?: boolean;
  footer?: ReactNode;
  /** Clears the fixed mobile bottom nav. Slice 7 passes `bottom-0`. */
  footerOffsetClass?: string;
}

export function DocFrame({ title, subtitle, onBack, flow, children, contentDisabled, footer, footerOffsetClass = "bottom-20" }: DocFrameProps) {
  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pt-3 pb-4 flex flex-col gap-4" data-testid="doc-frame">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-xl"
          aria-label="Back"
          onClick={onBack}
          disabled={flow?.busy}
          data-testid="button-doc-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight text-slate-900 truncate" data-testid="text-doc-title">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground truncate" data-testid="text-doc-subtitle">{subtitle}</p>}
        </div>
        {flow && (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0"
            onClick={flow.onSaveExit}
            disabled={flow.busy}
            data-testid="button-save-exit"
          >
            Save &amp; exit
          </Button>
        )}
      </div>
      {flow && (
        <WizardHeader
          icon={Droplets}
          kindLabel="Controller"
          mode={flow.mode}
          recordIdentifier={flow.recordIdentifier}
          currentStep={flow.currentStep}
          totalSteps={flow.stepTitles.length}
          stepTitles={flow.stepTitles}
          accent="blue"
        />
      )}
      {/* Disabled while a save runs so nothing can change under a pending request. */}
      <fieldset disabled={!!contentDisabled} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" data-testid="doc-frame-content">{children}</fieldset>
      {footer && (
        <div className={cn("sticky z-20 lg:bottom-0 bg-white border-t -mx-4 px-4 pt-3 pb-4 flex flex-col gap-2", footerOffsetClass)}>
          {footer}
        </div>
      )}
    </div>
  );
}
