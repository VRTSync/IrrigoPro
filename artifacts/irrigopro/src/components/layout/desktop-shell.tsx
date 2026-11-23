import { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getImpersonationToken } from "@/lib/impersonation";
import {
  hasCapability,
  CAN_READ_INVOICES,
  OVERDUE_AGING_FILTER,
} from "@workspace/shared";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronRight, PanelLeft, Search, X } from "lucide-react";
import { PhoneNav } from "@/components/layout/phone-nav";
import PoweredByFooter from "@/components/layout/powered-by-footer";
import { NotificationSystem } from "@/components/notifications/notification-system";
import { safeGet, safeRemove, safeSet } from "@/utils/safeStorage";
import { useAuth } from "@/lib/auth-context";
import { resolveRouteMeta } from "./route-meta";
import { JumpToProvider, useJumpTo } from "./jump-to";
import { ImpersonationBanner } from "@/components/app-health/impersonation-banner";
import {
  findActivePage,
  navForRole,
  type NavBadgeMap,
  type ResolvedNavSection,
} from "./nav-config";
import { useNavPins } from "./nav-pins";
import { NavRail } from "./nav-rail";
import { PagesPanel } from "./pages-panel";
import { NAV_EXPANDED_MEDIA, useNavExpanded } from "./use-nav-expanded";
import type { Part, ManualPartReview, Estimate } from "@workspace/db/schema";

const SHELL_HINT_SEEN_KEY = "irrigopro_desktop_shell_seen";

// Task #1914 — the overdue-invoice badge reads its number from the invoice
// list endpoint's own overdue aging filter (OVERDUE_AGING_FILTER, shared with
// the endpoint that applies it), so the badge cannot disagree with the aging
// rules in lib/shared/src/invoice-aging.ts or with the list the bookkeeper
// lands on. `limit=1&offset=0` asks for the smallest possible page: the number
// we want is the POST-filter total the endpoint reports in X-Total-Count, and
// counting returned rows client-side would cap the badge at a page size.
export const OVERDUE_INVOICES_URL =
  `/api/invoices?aging=${OVERDUE_AGING_FILTER}&limit=1&offset=0`;

async function fetchOverdueInvoiceCount(): Promise<number | null> {
  try {
    const headers: Record<string, string> = {};
    const impToken = getImpersonationToken();
    if (impToken) headers["x-impersonation-token"] = impToken;
    const res = await fetch(OVERDUE_INVOICES_URL, {
      credentials: "include",
      headers,
    });
    if (!res.ok) return null;
    const raw = res.headers.get("X-Total-Count");
    if (raw == null) return null;
    const total = Number(raw);
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/**
 * @param enabled          the four long-standing approval badges
 * @param overdueEnabled   the overdue-invoice badge, gated separately
 *
 * Task #1914 — the two gates are deliberately independent. `enabled` is a
 * hardcoded role list that predates the bookkeeper; folding the overdue query
 * into it would either leave her badge dead or start four roles polling
 * endpoints they have never polled. Neither flag may widen the other.
 */
function useNavBadges(enabled: boolean, overdueEnabled: boolean): NavBadgeMap {
  // Task #539 — see notification-system.tsx: the workspace queryFn
  // default returns `null` on 401 (so destructure defaults like
  // `data = []` DO NOT apply). Coerce each badge query through
  // `Array.isArray(...) ? ... : []` so a logged-out probe can never
  // resurface as a render-time `i.some` / `i.length` crash.
  const { data: pendingPartsRaw } = useQuery<Part[] | null>({
    queryKey: ["/api/parts/pending-approval"],
    enabled,
    refetchInterval: 60000,
  });
  const { data: pendingReviewsRaw } = useQuery<ManualPartReview[] | null>({
    queryKey: ["/api/manual-part-reviews"],
    enabled,
    refetchInterval: 60000,
  });
  const { data: wetCheckPendingRaw } = useQuery<unknown[] | null>({
    queryKey: ["/api/wet-checks/pending-review"],
    enabled,
    refetchInterval: 60000,
  });
  const { data: pendingEstimatesRaw } = useQuery<Estimate[] | null>({
    queryKey: ["/api/estimates/pending-approval"],
    enabled,
    refetchInterval: 60000,
  });
  const { data: needsApprovalCountRaw } = useQuery<{
    workOrderCount?: number;
    billingSheetCount?: number;
    total?: number;
  } | null>({
    queryKey: ["/api/manager-workspace/needs-approval/count"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/manager-workspace/needs-approval/count");
        if (!res.ok) return null;
        return (await res.json()) as {
          workOrderCount?: number;
          billingSheetCount?: number;
          total?: number;
        };
      } catch {
        return null;
      }
    },
    enabled,
    refetchInterval: 60000,
  });
  // Task #1914 — its own `enabled`, never the flag above.
  const { data: overdueInvoicesRaw } = useQuery<number | null>({
    queryKey: [OVERDUE_INVOICES_URL],
    queryFn: fetchOverdueInvoiceCount,
    enabled: overdueEnabled,
    refetchInterval: 60000,
  });
  const pendingParts = Array.isArray(pendingPartsRaw) ? pendingPartsRaw : [];
  const pendingReviews = Array.isArray(pendingReviewsRaw) ? pendingReviewsRaw : [];
  const wetCheckPending = Array.isArray(wetCheckPendingRaw) ? wetCheckPendingRaw : [];
  const pendingEstimates = Array.isArray(pendingEstimatesRaw) ? pendingEstimatesRaw : [];
  const awaitingApprovalCount =
    typeof needsApprovalCountRaw?.total === "number" ? needsApprovalCountRaw.total : 0;
  return {
    partsPendingApproval: pendingParts.length + pendingReviews.length,
    wetCheckReviews: wetCheckPending.length,
    estimatesPendingApproval: pendingEstimates.length,
    awaitingApproval: awaitingApprovalCount,
    // A failed or not-yet-resolved count is 0, which the navigation renders as no
    // badge at all rather than a "0" the bookkeeper would have to interpret.
    overdueInvoices: typeof overdueInvoicesRaw === "number" ? overdueInvoicesRaw : 0,
  };
}

interface PageActionsContextValue {
  target: HTMLDivElement | null;
}

const PageActionsContext = createContext<PageActionsContextValue | null>(null);

export function PageActions({ children }: { children: React.ReactNode }) {
  const ctx = useContext(PageActionsContext);
  if (!ctx || !ctx.target) return null;
  return createPortal(children, ctx.target);
}

interface SessionUser {
  id?: number;
  name?: string;
  email?: string;
  role?: string;
}

interface DesktopShellProps {
  role: string;
  children: React.ReactNode;
}

export function DesktopShell({ role: userRole, children }: DesktopShellProps) {
  const { saved, effective, toggle, collapse } = useNavExpanded();

  useEffect(() => {
    safeRemove("irrigopro_nav_panel_open");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented || event.repeat ||
        event.key.toLowerCase() !== "b" || !(event.metaKey || event.ctrlKey) ||
        event.altKey || event.shiftKey || !window.matchMedia?.(NAV_EXPANDED_MEDIA)?.matches
      ) return;
      const focus = document.activeElement;
      const editable = focus?.closest("[contenteditable]")?.getAttribute("contenteditable")?.toLowerCase();
      if (
        focus?.closest("input, textarea, select") ||
        (focus instanceof HTMLElement && focus.isContentEditable) ||
        editable === "" || editable === "true" || editable === "plaintext-only"
      ) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const { user: authUser } = useAuth();
  const user: SessionUser = useMemo<SessionUser>(
    () => ({
      id: authUser?.id,
      name: authUser?.name,
      email: authUser?.email,
      role: authUser?.role,
    }),
    [authUser],
  );
  const sections = useMemo(() => navForRole(userRole), [userRole]);
  const [location, navigate] = useLocation();
  const search = useSearch();
  const activePage = useMemo(
    () => findActivePage(sections, location, search),
    [sections, location, search],
  );
  const [recent, setRecent] = useState<{
    sectionId?: string;
    pageIds: Record<string, string>;
  }>({ pageIds: {} });
  useEffect(() => {
    if (!activePage) return;
    const { sectionId, id } = activePage;
    setRecent((previous) => {
      if (previous.sectionId === sectionId && previous.pageIds[sectionId] === id) return previous;
      return { sectionId, pageIds: { ...previous.pageIds, [sectionId]: id } };
    });
  }, [activePage]);

  const panelSection = sections.find(({ id }) => id === (activePage?.sectionId ?? recent.sectionId));
  const panelVisible = panelSection && panelSection.pages.length > 1;
  const pins = useNavPins(user.id, userRole);
  const selectSection = (sectionId: string) => {
    const section = sections.find(({ id }) => id === sectionId);
    const page = section?.pages.find(({ id }) => id === recent.pageIds[sectionId]) ?? section?.pages[0];
    if (page) navigate(page.href);
  };
  const brandThemed =
    userRole === "company_admin" ||
    userRole === "billing_manager" ||
    userRole === "irrigation_manager" ||
    userRole === "bookkeeper";
  const enableBadges =
    userRole === "company_admin" ||
    userRole === "billing_manager" ||
    userRole === "irrigation_manager";
  // Task #1914 — the overdue badge is gated on the capability that guards the
  // endpoint it reads (requireInvoiceRead), not on the role list above. A role
  // without CAN_READ_INVOICES — a field tech — issues no request for it at all,
  // rather than firing one that 403s in the background.
  const enableOverdueBadge = hasCapability(userRole, CAN_READ_INVOICES);
  const badges = useNavBadges(enableBadges, enableOverdueBadge);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const actionsContextValue = useMemo(
    () => ({ target: actionsTarget }),
    [actionsTarget],
  );

  return (
    <JumpToProvider role={userRole}>
      <PageActionsContext.Provider value={actionsContextValue}>
        <div data-testid="desktop-shell" className="flex min-h-screen">
          <div className="hidden shrink-0 lg:flex">
            <NavRail
              sections={sections}
              badges={badges}
              user={user}
              activePage={activePage}
              brandThemed={brandThemed}
              onSelectSection={selectSection}
              expanded={effective}
              onCollapse={collapse}
            />
            {panelVisible && (
              <PagesPanel key={panelSection.id} section={panelSection} activePage={activePage} badges={badges} pins={pins} />
            )}
          </div>
          {/* Let the main column shrink instead of letting a wide table set its width. */}
          <main className="flex min-w-0 flex-1 flex-col bg-background max-lg:pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
            <div className="sticky top-0 z-30 lg:hidden">
              <PhoneNav sections={sections} activePage={activePage} badges={badges} user={user} brandThemed={brandThemed} />
            </div>
            <ImpersonationBanner />
            <TopStrip
              sections={sections}
              user={user}
              actionsRef={setActionsTarget}
              navSavedExpanded={saved}
              navExpanded={effective}
              toggleNav={toggle}
            />
            <div className="flex-1 min-w-0 bg-gray-50">{children}</div>
            <PoweredByFooter />
          </main>
        </div>
      </PageActionsContext.Provider>
    </JumpToProvider>
  );
}

function TopStrip({
  sections,
  user,
  actionsRef,
  navSavedExpanded,
  navExpanded,
  toggleNav,
}: {
  sections: ResolvedNavSection[];
  user: SessionUser;
  actionsRef: (el: HTMLDivElement | null) => void;
  navSavedExpanded: boolean;
  navExpanded: boolean;
  toggleNav: () => void;
}) {
  const { open: openJumpTo, isOpen: jumpToOpen } = useJumpTo();
  const isApple = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const toggleLabel = navExpanded ? "Collapse main menu" : "Expand main menu";
  const [location] = useLocation();
  const search = useSearch();
  const meta = useMemo(
    () => resolveRouteMeta(location, sections, search),
    [location, sections, search],
  );
  return (
    <header className="hidden lg:flex sticky top-0 z-30 h-14 shrink-0 items-center gap-2.5 border-b border-gray-200 bg-white px-5">
      <ShellHint savedExpanded={navSavedExpanded}>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="hidden size-9 shrink-0 rounded-[10px] border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 min-[1200px]:flex"
          aria-label={toggleLabel}
          aria-pressed={navExpanded}
          title={`${toggleLabel} (${isApple ? "Cmd+B" : "Ctrl+B"})`}
          data-testid="button-toggle-main-menu"
          onClick={toggleNav}
        >
          <PanelLeft aria-hidden="true" />
        </Button>
      </ShellHint>
      <nav
        aria-label="Breadcrumb"
        className="flex items-center text-sm text-gray-600 min-w-0"
      >
        <ol className="flex items-center gap-1.5 min-w-0">
          {meta.breadcrumb.map((seg, i) => {
            const isLast = i === meta.breadcrumb.length - 1;
            return (
              <li
                key={`${i}-${seg.label}`}
                className="flex items-center gap-1.5 min-w-0"
              >
                {i > 0 && (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                )}
                {seg.path && !isLast ? (
                  <Link
                    href={seg.path}
                    className="hover:text-gray-900 truncate"
                  >
                    {seg.label}
                  </Link>
                ) : (
                  <span
                    className={`truncate ${
                      isLast ? "font-medium text-gray-900" : ""
                    }`}
                  >
                    {seg.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <div ref={actionsRef} className="flex items-center gap-2" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-2 text-slate-600"
          aria-haspopup="dialog"
          aria-expanded={jumpToOpen}
          aria-keyshortcuts={isApple ? "Meta+K" : "Control+K"}
          data-testid="button-desktop-jump-to"
          onClick={openJumpTo}
        >
          <Search aria-hidden="true" />
          Jump to...
          <kbd aria-hidden="true" className="whitespace-nowrap rounded border bg-slate-50 px-1.5 text-xs">
            {isApple ? "Cmd K" : "Ctrl K"}
          </kbd>
        </Button>
        {typeof user.id === "number" && (
          <NotificationSystem userId={user.id} />
        )}
      </div>
    </header>
  );
}

function ShellHint({
  savedExpanded,
  children,
}: {
  savedExpanded: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const interactedRef = useRef(false);
  const initialExpandedRef = useRef(savedExpanded);
  useEffect(() => {
    if (interactedRef.current) return;
    if (savedExpanded === initialExpandedRef.current) return;
    interactedRef.current = true;
    if (safeGet(SHELL_HINT_SEEN_KEY) === "true") return;
    setOpen(true);
  }, [savedExpanded]);
  const dismiss = () => {
    safeSet(SHELL_HINT_SEEN_KEY, "true");
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="hidden w-64 p-3 text-sm min-[1200px]:block"
      >
        <div className="flex items-start gap-2">
          <p className="flex-1 text-gray-700">
            Press Cmd+B (Ctrl+B on Windows) to show section names in the main menu.
          </p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss hint"
            className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
