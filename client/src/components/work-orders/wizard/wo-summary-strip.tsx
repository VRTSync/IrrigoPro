import { MapPin, User, Building2, Edit } from "lucide-react";
import type { WorkLocation } from "./wo-location-step";

interface Props {
  customerName: string;
  branchName: string;
  pinnedLocation: WorkLocation | null;
  onEditPin: () => void;
}

export function WizardSummaryStrip({ customerName, branchName, pinnedLocation, onEditPin }: Props) {
  if (!customerName && !pinnedLocation) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-sm text-blue-900">
      <div className="flex items-center gap-3 min-w-0 flex-1 flex-wrap">
        {customerName && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <User className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
            <span className="font-medium truncate max-w-[180px]">{customerName}</span>
          </span>
        )}
        {branchName && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <Building2 className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
            <span className="truncate max-w-[140px]">{branchName}</span>
          </span>
        )}
        {pinnedLocation && (
          <span className="inline-flex items-center gap-1 min-w-0">
            <MapPin className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
            <span className="truncate max-w-[260px]">
              {pinnedLocation.address ||
                `${pinnedLocation.lat.toFixed(5)}, ${pinnedLocation.lng.toFixed(5)}`}
            </span>
          </span>
        )}
      </div>
      {pinnedLocation && (
        <button
          type="button"
          onClick={onEditPin}
          className="text-xs font-medium text-blue-700 hover:text-blue-900 inline-flex items-center gap-1 flex-shrink-0"
        >
          <Edit className="w-3 h-3" /> Edit pin
        </button>
      )}
    </div>
  );
}
