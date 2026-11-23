import { useEffect, useMemo, useState } from "react";
import { safeGet, safeSet } from "@/utils/safeStorage";
import { navForRole } from "./nav-config";

export const NAV_PIN_LIMIT = 8;

export function navPinsKey(userId: number): string {
  return `irrigopro_nav_pins_${userId}`;
}

export interface NavPins {
  pinnedIds: string[];
  isPinned(id: string): boolean;
  toggle(id: string): void;
  atLimit: boolean;
}

function readPins(key: string | null): string[] {
  if (!key) return [];
  const stored = safeGet(key);
  if (stored === null) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id): id is string => typeof id === "string"))]
      : [];
  } catch {
    return [];
  }
}

export function useNavPins(userId: number | undefined, role: string | undefined): NavPins {
  const key = userId === undefined ? null : navPinsKey(userId);
  const visibleIds = useMemo(
    () => new Set(navForRole(role).flatMap(({ pages }) => pages.map(({ id }) => id))),
    [role],
  );
  const [stored, setStored] = useState(() => ({ key, ids: readPins(key), changed: false }));
  // Reset before rendering a different account's pins, not one effect later.
  if (stored.key !== key) setStored({ key, ids: readPins(key), changed: false });
  const pinnedIds = stored.key === key ? stored.ids.filter((id) => visibleIds.has(id)) : [];

  useEffect(() => {
    if (key && stored.key === key && stored.changed) safeSet(key, JSON.stringify(stored.ids));
  }, [key, stored]);

  return {
    pinnedIds,
    isPinned: (id) => pinnedIds.includes(id),
    atLimit: pinnedIds.length >= NAV_PIN_LIMIT,
    toggle(id) {
      if (!key || !visibleIds.has(id)) return;
      setStored((previous) => {
        if (previous.key !== key) return previous;
        const ids = previous.ids.filter((pin) => visibleIds.has(pin));
        if (ids.includes(id)) return { key, ids: ids.filter((pin) => pin !== id), changed: true };
        if (ids.length >= NAV_PIN_LIMIT) return previous;
        return { key, ids: [...ids, id], changed: true };
      });
    },
  };
}
