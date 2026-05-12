// ─── Property context header (Task #428) ──────────────────────────────────────
// Sticky banner shown on every wet-check screen so the tech is never one tap
// away from forgetting which property they're standing on. Drilling into a
// controller / zone appends those breadcrumbs without losing the customer
// + address line.
export function PropertyContextHeader({
  customerName,
  propertyAddress,
  controllerLetter,
  zoneNumber,
}: {
  customerName: string;
  propertyAddress: string | null | undefined;
  controllerLetter?: string | null;
  zoneNumber?: number | null;
}) {
  const breadcrumb: string[] = [];
  if (controllerLetter) breadcrumb.push(`Controller ${controllerLetter}`);
  if (zoneNumber != null) breadcrumb.push(`Zone ${zoneNumber}`);
  return (
    <div
      className="sticky top-0 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 bg-white/95 backdrop-blur border-b shadow-sm"
      data-testid="property-context-header"
    >
      <div className="max-w-3xl mx-auto">
        <div
          className="text-sm font-semibold text-gray-900 truncate"
          data-testid="property-context-customer"
        >
          {customerName}
        </div>
        <div
          className="text-xs text-gray-600 truncate"
          data-testid="property-context-address"
        >
          {propertyAddress ?? "—"}
          {breadcrumb.length > 0 && (
            <>
              <span className="mx-1.5 text-gray-300">·</span>
              <span data-testid="property-context-breadcrumb">{breadcrumb.join(" · ")}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
