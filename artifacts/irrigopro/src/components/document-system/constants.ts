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
