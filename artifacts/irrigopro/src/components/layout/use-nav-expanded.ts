import { useCallback, useEffect, useState } from "react";
import { safeGet, safeSet } from "@/utils/safeStorage";

const STORAGE_KEY = "irrigopro_nav_expanded";
export const NAV_EXPANDED_MEDIA = "(min-width: 1200px)";

export function useNavExpanded(): {
  saved: boolean;
  effective: boolean;
  toggle(): void;
  collapse(): void;
} {
  const [preference, setPreference] = useState(() => ({
    saved: safeGet(STORAGE_KEY) === "true",
    changed: false,
  }));
  const [media] = useState(() => globalThis.matchMedia?.(NAV_EXPANDED_MEDIA));
  const [canExpand, setCanExpand] = useState(media?.matches ?? false);

  useEffect(() => {
    if (!media) return;
    const update = () => setCanExpand(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, [media]);

  const { saved, changed } = preference;
  useEffect(() => {
    if (changed) safeSet(STORAGE_KEY, String(saved));
  }, [saved, changed]);

  const toggle = useCallback(() => {
    setPreference(({ saved }) => ({ saved: !saved, changed: true }));
  }, []);
  const collapse = useCallback(() => setPreference({ saved: false, changed: true }), []);

  return { saved, effective: saved && canExpand, toggle, collapse };
}
