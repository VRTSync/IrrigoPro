import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth, type WebUser } from "./auth-context";
import { apiRequest } from "./queryClient";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  clearSessionAndLogout: vi.fn(),
}));

const stored = { id: 5, role: "field_tech", companyId: 1, clientOnly: "keep me" };
const server: WebUser = {
  id: 5, role: "field_tech", companyId: 1, name: "Server Name",
  username: "fixture", email: "fixture@example.test", isActive: true,
};
const request = vi.mocked(apiRequest);
const reload = vi.fn();

function CurrentUser() {
  const { user } = useAuth();
  return <output>{user?.name}</output>;
}

async function mount() {
  await act(async () => {
    render(<AuthProvider><CurrentUser /></AuthProvider>);
  });
}

beforeEach(() => {
  localStorage.setItem("user", JSON.stringify(stored));
  request.mockReset();
  reload.mockClear();
  // jsdom's real Location is non-configurable.
  vi.stubGlobal("window", Object.create(window, { location: { value: { reload } } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("stored session identity", () => {
  it("refreshes display fields in context and storage without reloading", async () => {
    request.mockResolvedValue(server);
    await mount();
    expect(request.mock.calls).toEqual([["/api/auth/user", "GET"]]);
    expect(screen.getByText("Server Name")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("user")!)).toEqual({ ...stored, ...server });
    expect(reload).not.toHaveBeenCalled();
  });

  it.each<Partial<WebUser>>([{ role: "super_admin" }, { id: 42 }, { companyId: 2 }])(
    "reloads after storing the changed identity %o",
    async (changes) => {
      const changed = { ...server, ...changes };
      request.mockResolvedValue(changed);
      await mount();
      expect(JSON.parse(localStorage.getItem("user")!)).toEqual({ ...stored, ...changed });
      expect(reload).toHaveBeenCalledTimes(1);
    },
  );

  it("treats a missing company and a null company as the same identity", async () => {
    const { companyId, ...userWithoutCompany } = stored;
    localStorage.setItem("user", JSON.stringify(userWithoutCompany));
    request.mockResolvedValue({ ...server, companyId: null });
    await mount();
    expect(JSON.parse(localStorage.getItem("user")!).companyId).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it.each([
    ["a failed network request", new TypeError("Failed to fetch")],
    ["a 401 handled by apiRequest", new Error("401: Authentication required")],
  ])("does not touch storage or reload after %s", async (_description, error) => {
    request.mockRejectedValue(error);
    await mount();
    expect(request).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("user")).toBe(JSON.stringify(stored));
    expect(reload).not.toHaveBeenCalled();
  });

  it("skips the request when the browser already knows it is offline", async () => {
    const offline = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    try {
      await mount();
      expect(request).not.toHaveBeenCalled();
      expect(localStorage.getItem("user")).toBe(JSON.stringify(stored));
      expect(reload).not.toHaveBeenCalled();
    } finally {
      offline.mockRestore();
    }
  });

  it("does not look up a session when no user is stored", async () => {
    localStorage.removeItem("user");
    await mount();
    expect(request).not.toHaveBeenCalled();
  });

  it("ignores a response that finishes after logout removes the stored account", async () => {
    let resolve!: (user: WebUser) => void;
    request.mockReturnValue(new Promise<WebUser>((done) => { resolve = done; }));
    await mount();
    localStorage.removeItem("user");
    await act(async () => { resolve({ ...server, id: 42 }); });
    expect(localStorage.getItem("user")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
