import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DismissibleHelp, isHelpDismissed, resetHelpDismissal, KEY_PREFIX } from "./dismissible-help";

const GUIDE_ID = "test-guide-abc";
const STORAGE_KEY = `${KEY_PREFIX}anon:${GUIDE_ID}`;

vi.mock("@/utils/safeStorage", () => ({
  safeGet: (_k: string) => null,
  safeSet: () => {},
  safeRemove: () => {},
}));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("DismissibleHelp primitive", () => {
  it("renders children when the guide has not been dismissed", () => {
    render(
      <DismissibleHelp guideId={GUIDE_ID}>
        Press <kbd>A</kbd> to approve
      </DismissibleHelp>,
    );
    expect(screen.getByTestId(`dismissible-help-${GUIDE_ID}`)).toBeTruthy();
    expect(screen.getByText(/Press/)).toBeTruthy();
  });

  it("does NOT render when the guide is already dismissed in localStorage", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    render(
      <DismissibleHelp guideId={GUIDE_ID}>Help text</DismissibleHelp>,
    );
    expect(screen.queryByTestId(`dismissible-help-${GUIDE_ID}`)).toBeNull();
  });

  it("dismiss button writes localStorage key and unmounts the component", () => {
    render(
      <DismissibleHelp guideId={GUIDE_ID}>Help text</DismissibleHelp>,
    );
    expect(screen.getByTestId(`dismissible-help-${GUIDE_ID}`)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`dismissible-help-${GUIDE_ID}-dismiss`));

    expect(screen.queryByTestId(`dismissible-help-${GUIDE_ID}`)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("1");
  });

  it("Esc key dismisses the component", () => {
    render(
      <DismissibleHelp guideId={GUIDE_ID}>Help text</DismissibleHelp>,
    );
    expect(screen.getByTestId(`dismissible-help-${GUIDE_ID}`)).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByTestId(`dismissible-help-${GUIDE_ID}`)).toBeNull();
  });

  it("persistDismissal=false does NOT write to localStorage on dismiss", () => {
    render(
      <DismissibleHelp guideId={GUIDE_ID} persistDismissal={false}>
        Transient help
      </DismissibleHelp>,
    );
    fireEvent.click(screen.getByTestId(`dismissible-help-${GUIDE_ID}-dismiss`));

    expect(screen.queryByTestId(`dismissible-help-${GUIDE_ID}`)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("isHelpDismissed returns true after dismiss and false after resetHelpDismissal", () => {
    expect(isHelpDismissed(GUIDE_ID)).toBe(false);

    window.localStorage.setItem(STORAGE_KEY, "1");
    expect(isHelpDismissed(GUIDE_ID)).toBe(true);

    resetHelpDismissal(GUIDE_ID);
    expect(isHelpDismissed(GUIDE_ID)).toBe(false);
  });

  it("isHelpDismissed returns false when key is absent", () => {
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(isHelpDismissed(GUIDE_ID)).toBe(false);
  });

  it("resetHelpDismissal clears the localStorage key", () => {
    window.localStorage.setItem(STORAGE_KEY, "1");
    expect(isHelpDismissed(GUIDE_ID)).toBe(true);

    resetHelpDismissal(GUIDE_ID);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("renders with warning variant when specified", () => {
    render(
      <DismissibleHelp guideId={GUIDE_ID} variant="warning">
        Warning content
      </DismissibleHelp>,
    );
    const el = screen.getByTestId(`dismissible-help-${GUIDE_ID}`);
    expect(el.className).toContain("amber");
  });
});
