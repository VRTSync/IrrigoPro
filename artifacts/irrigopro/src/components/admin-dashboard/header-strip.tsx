import { Card, CardContent } from "@/components/ui/card";
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

const HEALTH_STYLE: Record<Health, { bg: string; text: string; border: string; icon: React.ComponentType<{ className?: string }>; label: string }> = {
  green: { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-200",  icon: CheckCircle2,  label: "All clear" },
  amber: { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200",  icon: AlertTriangle, label: "Needs attention" },
  red:   { bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200",    icon: AlertCircle,   label: "Action required" },
};

export function HeaderStrip({ name, health, healthLabel, companyLogoUrl, companyName }: HeaderStripProps) {
  const style = HEALTH_STYLE[health];
  const Icon = style.icon;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {companyLogoUrl && (
              <img
                src={companyLogoUrl}
                alt={companyName ? `${companyName} logo` : "Company logo"}
                className="h-12 w-12 rounded-md object-contain bg-white border border-gray-100 shrink-0"
                data-testid="img-company-logo"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 truncate" data-testid="text-dashboard-greeting">
                {name ? `Welcome back, ${name.split(" ")[0]}` : "Welcome back"}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {today}
                {companyName ? <span className="text-gray-300 mx-1.5">·</span> : null}
                {companyName && <span className="font-medium text-gray-600">{companyName}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant="outline" className="text-xs hidden sm:flex">
              <Shield className="w-3.5 h-3.5 mr-1" />
              Administrator
            </Badge>
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${style.bg} ${style.border}`}
              data-testid="indicator-system-health"
              title={healthLabel}
            >
              <Icon className={`w-4 h-4 ${style.text}`} />
              <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

