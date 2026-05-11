// Task #495 — Locks in the sync-failed UX for a poison `photo.upload`
// mutation. The server-side fix sanitizes the toast message, but the
// queue itself must still surface a per-mutation Retry / Cancel
// affordance for the field tech so they can clear or re-drive a
// permanently failing upload without wiping the whole wet check.
//
// The MutationRow component in sync-ui.tsx already drives this purely
// off `m.status === "failed"` (kind-agnostic) — this test holds it in
// place by rendering a failed `photo.upload` row directly and asserting
// both buttons are present, the friendly error appears, and the
// callbacks fire with the mutation's id.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";

import type { QueuedMutation } from "@/lib/offline/types";

// MutationRow is not exported, so we mount the part of sync-ui that
// renders queue rows by reaching through QueueView's failed-section.
// Cleaner: import the row through a re-export shim. Since adding an
// export is a tiny no-risk change, do that.
import { MutationRow } from "./sync-ui";

function makeFailedPhotoUpload(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    id: "mut-photo-1",
    kind: "photo.upload",
    method: "POST",
    urlTemplate: "/api/wet-checks/100/photos",
    body: { url: "photos/abc123" },
    clientId: "11111111-2222-3333-4444-555555555555",
    parentClientId: null,
    placeholders: {},
    attemptCount: 4,
    lastAttemptAt: Date.now() - 30_000,
    lastError: "Couldn't attach photo — please retry",
    status: "failed",
    createdAt: Date.now() - 120_000,
    resolvedId: null,
    progress: 60,
    ...overrides,
  };
}

describe("MutationRow — poison photo.upload (Task #495)", () => {
  it("renders Retry and Cancel for a failed photo.upload, with a friendly error message and no leaked SQL", () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    const m = makeFailedPhotoUpload();

    render(<MutationRow m={m} onCancel={onCancel} onRetry={onRetry} />);

    // The row labels the kind in user-readable form.
    expect(screen.getByText("Upload photo")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();

    // The error line shows the safe message from the server, never SQL.
    const errLine = screen.getByTestId(`queue-error-${m.id}`);
    expect(errLine.textContent).toContain("Couldn't attach photo");
    expect(errLine.textContent).not.toMatch(/Failed query/i);
    expect(errLine.textContent).not.toMatch(/select/i);

    // Both affordances are present and wired to the right id.
    const retry = screen.getByTestId(`queue-retry-${m.id}`);
    const cancel = screen.getByTestId(`queue-cancel-${m.id}`);
    expect(retry).toBeInTheDocument();
    expect(cancel).toBeInTheDocument();

    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith(m.id);

    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledWith(m.id);
  });

  it("a syncing photo.upload that has been retrying still exposes Cancel so it cannot get stuck without recourse", () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    const m = makeFailedPhotoUpload({ status: "syncing", lastError: null });

    render(<MutationRow m={m} onCancel={onCancel} onRetry={onRetry} />);

    expect(screen.getByText("Syncing")).toBeInTheDocument();
    // No Retry on a syncing row, but Cancel must still be available so
    // the tech can break out of an infinite-retry loop on a permanent
    // failure that the engine hasn't yet flipped to `failed`.
    expect(screen.queryByTestId(`queue-retry-${m.id}`)).toBeNull();
    expect(screen.getByTestId(`queue-cancel-${m.id}`)).toBeInTheDocument();
  });

  it("a completed photo.upload offers no Retry or Cancel (final state)", () => {
    const onCancel = vi.fn();
    const onRetry = vi.fn();
    const m = makeFailedPhotoUpload({ status: "completed", lastError: null });

    render(<MutationRow m={m} onCancel={onCancel} onRetry={onRetry} />);

    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByTestId(`queue-retry-${m.id}`)).toBeNull();
    expect(screen.queryByTestId(`queue-cancel-${m.id}`)).toBeNull();
  });
});
