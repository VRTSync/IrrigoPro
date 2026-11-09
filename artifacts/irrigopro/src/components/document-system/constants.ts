export const CLOCK_LOCATIONS = ["Garage wall", "Exterior wall", "Mech room", "Pedestal", "Pump house"];
export const CONTROLLER_BRANDS = ["Hunter", "Rain Bird", "Toro", "Weathermatic", "Rachio"];
export const CONTROLLER_MODELS: Record<string, string[]> = {
  Hunter: ["Pro-C", "ICC2", "HPC", "X-Core", "HCC"],
  "Rain Bird": ["ESP-TM2", "ESP-ME3", "ESP-LXME2"],
  Toro: ["TMC-212", "Evolution", "Tempus"],
  Weathermatic: ["SmartLine SL4800", "SL1600"],
  Rachio: ["Rachio 3"],
};
export const QUICK_ZONE_COUNTS = [6, 8, 12, 16, 24, 32];

/** Turns an apiRequest error ("500: {\"message\":\"...\"}") into its server message. */
export function serverMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = /^\d{3}: ([\s\S]*)$/.exec(raw);
  const body = m ? m[1] : raw;
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === "string") return parsed.message;
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch { /* not JSON */ }
  return body;
}

/** Server enum values (irrigation-profile-routes.ts zone type enum); short labels fit a 60px tile. */
export const DOC_ZONE_TYPES = [
  { value: "pop_up_spray", label: "Spray",   tile: "bg-sky-100 border-sky-300" },
  { value: "rotor",        label: "Rotor",   tile: "bg-green-100 border-green-300" },
  { value: "drip",         label: "Drip",    tile: "bg-amber-100 border-amber-300" },
  { value: "netafim",      label: "Netafim", tile: "bg-orange-100 border-orange-300" },
  { value: "bubbler",      label: "Bubbler", tile: "bg-violet-100 border-violet-300" },
  { value: "other",        label: "Other",   tile: "bg-slate-200 border-slate-400" },
] as const;

/** Stored day format, same values and order as DAYS_OF_WEEK in irrigation-controller-grid.tsx. */
export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Values = backflowCreateBody.deviceType (irrigation-profile-routes.ts). */
export const BACKFLOW_TYPES = [
  { value: "rpz", label: "RPZ" }, { value: "double_check", label: "Double check" }, { value: "pvb", label: "PVB" },
  { value: "spill_resistant_pvb", label: "Spill-resistant PVB" }, { value: "other", label: "Other" },
] as const;
export const BACKFLOW_SIZES = ['3/4"', '1"', '1-1/4"', '1-1/2"', '2"', '2-1/2"', '3"'];
export const BACKFLOW_BRANDS = ["Febco", "Watts", "Wilkins", "Zurn", "Ames"];
export const BACKFLOW_LOCATIONS = ["By meter", "Front entry", "Side yard", "Vault", "Mech room"];

export function backflowTypeLabel(value: string | null | undefined): string {
  return BACKFLOW_TYPES.find((t) => t.value === value)?.label ?? (value || "");
}
