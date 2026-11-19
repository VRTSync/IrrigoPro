import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ apiRequest: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/queryClient", async (original) => ({
  ...await original<typeof import("@/lib/queryClient")>(), apiRequest: state.apiRequest,
}));
import { OutgoingEmailCard } from "./outgoing-email-card";

const fixture = () => ({
  sendingDomain: "highplainsprop.com", domainVerifiedAt: "2026-11-18T12:00:00Z",
  domainCheckedAt: "2026-11-18T12:00:00Z", domainCheckError: null,
  fromName: "High Plains", fromAddress: "billing@highplainsprop.com", replyTo: "office@highplainsprop.com",
  effective: { from: { name: "High Plains", email: "billing@highplainsprop.com" }, replyTo: "office@highplainsprop.com", usingCompanyAddress: true },
});
function mount(canEdit = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><OutgoingEmailCard companyId={1} canEdit={canEdit} /></QueryClientProvider>);
  return vi.spyOn(client, "invalidateQueries");
}
beforeEach(() => {
  state.apiRequest.mockReset().mockResolvedValue(fixture());
  state.toast.mockReset();
});
describe("Outgoing email card", () => {
  it("displays the effective sender and authenticated domain", async () => {
    mount();
    expect(await screen.findByTestId("status-domain-authenticated")).toHaveTextContent("Authenticated in SendGrid");
    expect(screen.getByTestId("text-effective-sender")).toHaveTextContent("Customers see: High Plains <billing@highplainsprop.com>. Replies go to office@highplainsprop.com.");
  });
  it("saves exactly the editable fields and refreshes sender settings", async () => {
    const invalidate = mount();
    await screen.findByTestId("input-from-name");
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: " New name " } });
    fireEvent.change(screen.getByLabelText("From address"), { target: { value: "accounts" } });
    fireEvent.change(screen.getByLabelText("Reply-To"), { target: { value: "reply@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(state.apiRequest).toHaveBeenCalledWith("/api/company/1/email-sender", "PUT", {
      fromName: "New name", fromLocalPart: "accounts", replyTo: "reply@example.com",
    }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/company/email-sender"] }));
  });
  it("keeps readers read-only with no buttons", async () => {
    mount(false);
    await screen.findByTestId("input-from-name");
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("explains missing domains and disables the local-part input", async () => {
    state.apiRequest.mockResolvedValue({ ...fixture(), sendingDomain: null, fromAddress: null, domainVerifiedAt: null });
    mount();
    expect(await screen.findByTestId("text-sending-domain-none")).toHaveTextContent("No sending domain assigned yet. Ask IrrigoPro support to set one up.");
    expect(screen.getByLabelText("From address")).toBeDisabled();
  });
  it("shows unauthenticated fallback and checks again", async () => {
    const data = fixture();
    state.apiRequest.mockResolvedValue({ ...data, domainVerifiedAt: null, domainCheckError: "DNS not validated", effective: {
      ...data.effective, from: { name: "High Plains", email: "platform@example.com" }, usingCompanyAddress: false,
    } });
    mount();
    expect(await screen.findByTestId("status-domain-unauthenticated")).toHaveTextContent("DNS not validated");
    expect(screen.getByTestId("text-effective-sender")).toHaveTextContent("Your address isn't authenticated yet, so mail is sent from platform@example.com on your behalf.");
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(state.apiRequest).toHaveBeenCalledWith("/api/company/1/email-sender/check", "POST"));
  });
  it("renders errors without exposing buttons to read-only users", async () => {
    state.apiRequest.mockRejectedValue(new Error("Unavailable"));
    mount(false);
    await screen.findByTestId("status-outgoing-email-error");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
