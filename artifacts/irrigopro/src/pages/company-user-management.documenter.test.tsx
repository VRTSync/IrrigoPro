import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import CompanyUserManagement from "./company-user-management";
import { queryClient } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const proto = HTMLElement.prototype;
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};
proto.scrollIntoView ??= () => {};

let users: any[];
let writes: { method: string; url: string; body: any }[];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("user", JSON.stringify({ id: 1, companyId: 17, name: "Admin", role: "company_admin" }));
  queryClient.clear();
  users = [{ id: 2, username: "documenter", phone: "3035550101", name: "Field Documenter", email: "", role: "system_documenter", companyId: 17, isActive: true, emailVerified: true }];
  writes = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "GET" && url === "/api/company/17/users") return Response.json(users);
    if ((method === "POST" && url === "/api/company/17/users") || (method === "PUT" && url === "/api/company/17/users/2")) {
      const body = JSON.parse(String(init?.body));
      writes.push({ url, method, body });
      users = method === "POST" ? [...users, { ...users[0], ...body, id: 3 }] : [{ ...users[0], ...body }];
      return Response.json(users.at(-1));
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  }));
});
afterEach(() => { cleanup(); queryClient.clear(); vi.unstubAllGlobals(); });

async function mount() {
  render(<QueryClientProvider client={queryClient}><TooltipProvider><CompanyUserManagement /></TooltipProvider></QueryClientProvider>);
  await screen.findAllByText("Field Documenter");
}

async function selectRole(dialog: HTMLElement, role: string) {
  fireEvent.pointerDown(within(dialog).getByRole("combobox"), { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(await screen.findByRole("option", { name: role, exact: true }));
}

async function editUser() {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit User" }));
  return screen.findByRole("dialog");
}

describe("company admins assign the System Documenter role", () => {
  it("offers System Documenter immediately after Field Tech and sends the exact role on create", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Add User" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Full Name"), { target: { value: "New Documenter" } });
    fireEvent.change(within(dialog).getByLabelText(/Phone/), { target: { value: "3035550102" } });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "fixture-only-password" } });
    fireEvent.pointerDown(within(dialog).getByRole("combobox"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(screen.getAllByRole("option").map(o => o.textContent)).toEqual(["Manager", "Field Tech", "System Documenter", "Billing Manager", "Bookkeeper"]);
    fireEvent.click(screen.getByRole("option", { name: "System Documenter" }));
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: "POST", url: "/api/company/17/users", body: { role: "system_documenter", name: "New Documenter" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findAllByText("New Documenter")).toHaveLength(2);
  });

  it("shows the teal badge, exact label and ClipboardCheck icon in the row", async () => {
    await mount();
    const badges = screen.getAllByText("System Documenter");
    expect(badges.length).toBeGreaterThan(0);
    for (const badge of badges) {
      expect(badge.className).toContain("bg-teal-100");
      expect(badge.className).toContain("text-teal-800");
    }
    expect(document.querySelectorAll("svg.lucide-clipboard-check").length).toBe(2);
  });

  it("initializes and saves the existing documenter role on edit, then allows changing into it", async () => {
    users[0].role = "field_tech";
    await mount();
    let dialog = await editUser();
    await selectRole(dialog, "System Documenter");
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: "PUT", url: "/api/company/17/users/2", body: { role: "system_documenter" } });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findAllByText("System Documenter");
    dialog = await editUser();
    expect(within(dialog).getByRole("combobox").textContent).toContain("System Documenter");
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1].body.role).toBe("system_documenter");
  });

  it("keeps the existing company-admin-only access guard", async () => {
    localStorage.setItem("user", JSON.stringify({ id: 2, companyId: 17, role: "system_documenter" }));
    render(<QueryClientProvider client={queryClient}><TooltipProvider><CompanyUserManagement /></TooltipProvider></QueryClientProvider>);
    await screen.findByText("Access Denied");
    expect(screen.queryByRole("button", { name: "Add User" })).toBeNull();
  });
});
