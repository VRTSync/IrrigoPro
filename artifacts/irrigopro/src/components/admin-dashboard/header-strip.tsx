import irrigoLogoUrl from "@assets/irrigopro - logo - BLUE - FINAL_1756061385150.png";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, AlertCircle, Shield } from "lucide-react";

export type Health = "green" | "amber" | "red";

interface HeaderStripProps {
  name?: string;
  health: Health;
  healthLabel: string;
  companyLogoUrl?: string | null;
  companyName?: string | null;
}

const HEALTH_STYLE: Record<Health, { pill: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  green: { pill: "bg-green-500/20 border-green-400/40 text-green-200",  icon: CheckCircle2,  label: "All clear" },
  amber: { pill: "bg-amber-500/20 border-amber-400/40 text-amber-200",  icon: AlertTriangle, label: "Needs attention" },
  red:   { pill: "bg-red-500/20   border-red-400/40   text-red-200",    icon: AlertCircle,   label: "Action required" },
};

export function HeaderStrip({ name, health, healthLabel, companyLogoUrl, companyName }: HeaderStripProps) {
  const style = HEALTH_STYLE[health];
  const Icon = style.icon;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-blue-800 to-indigo-900 px-6 py-5 shadow-lg">
      {/* Decorative app logo watermark */}
      <img
        src={irrigoLogoUrl}
        alt=""
        aria-hidden="true"
        className="pointer-events-none select-none absolute right-4 top-1/2 -translate-y-1/2 h-[70%] max-h-28 object-contain opacity-[0.07]"
      />
      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {companyLogoUrl && (
            <img
              src={companyLogoUrl}
              alt={companyName ? `${companyName} logo` : "Company logo"}
              className="h-12 w-12 rounded-md object-contain bg-white/10 border border-white/20 shrink-0"
              data-testid="img-company-logo"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-white truncate" data-testid="text-dashboard-greeting">
              {name ? `Welcome back, ${name.split(" ")[0]}` : "Welcome back"}
            </h1>
            <p className="text-sm text-blue-200 mt-1">
              {today}
              {companyName ? <span className="text-blue-400 mx-1.5">·</span> : null}
              {companyName && <span className="font-medium text-blue-100">{companyName}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge
            variant="outline"
            className="text-xs hidden sm:flex border-white/30 text-blue-100 bg-white/10"
          >
            <Shield className="w-3.5 h-3.5 mr-1" />
            Administrator
          </Badge>
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${style.pill}`}
            data-testid="indicator-system-health"
            title={healthLabel}
          >
            <Icon className="w-4 h-4" />
            <span className="text-xs font-semibold">{style.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

