import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAV_EXPANDED_MEDIA, useNavExpanded } from "./use-nav-expanded";

const key = "irrigopro_nav_expanded";

function mockMedia(matches = true) {
  const media = Object.assign(new EventTarget(), { matches });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return (matches: boolean) => act(() => {
    media.matches = matches;
    media.dispatchEvent(new Event("change"));
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  mockMedia();
});
afterEach(() => vi.unstubAllGlobals());

describe("useNavExpanded", () => {
  it.each([
    [null, false], ["true", true], ["false", false], ["unexpected", false],
  ] as const)("reads %s as saved=%s without writing on mount", (value, saved) => {
    if (value !== null) localStorage.setItem(key, value);
    const { result } = renderHook(useNavExpanded);
    expect(result.current).toMatchObject({ saved, effective: saved });
    expect(localStorage.getItem(key)).toBe(value);
    expect(matchMedia).toHaveBeenCalledWith(NAV_EXPANDED_MEDIA);
  });

  it("persists toggles and collapse", () => {
    const { result } = renderHook(useNavExpanded);
    act(result.current.toggle);
    expect(result.current.effective).toBe(true);
    expect(localStorage.getItem(key)).toBe("true");
    act(result.current.toggle);
    expect(result.current.effective).toBe(false);
    expect(localStorage.getItem(key)).toBe("false");
    act(result.current.toggle);
    act(result.current.collapse);
    expect(result.current.saved).toBe(false);
    expect(localStorage.getItem(key)).toBe("false");
  });

  it("keeps the saved choice across the media query boundary", () => {
    const resize = mockMedia(false);
    localStorage.setItem(key, "true");
    const { result } = renderHook(useNavExpanded);
    expect(result.current).toMatchObject({ saved: true, effective: false });
    resize(true);
    expect(result.current).toMatchObject({ saved: true, effective: true });
    resize(false);
    expect(result.current).toMatchObject({ saved: true, effective: false });
    expect(localStorage.getItem(key)).toBe("true");
  });
});
