import { useEffect, useId, useRef, useState } from "react";
import { Ellipsis, LogOut, Search, User as UserIcon, type LucideIcon } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { NotificationSystem } from "@/components/notifications/notification-system";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { clearSessionAndLogout } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import irrigoProMark from "@assets/IrrigoPro_2026-05_1778193170303.png";
import { useJumpTo } from "./jump-to";
import type { NavBadgeMap, ResolvedNavPage, ResolvedNavSection } from "./nav-config";

export const PHONE_TAB_COUNT = 4;

export function splitPhoneTabs(sections: ResolvedNavSection[]): {
  tabs: ResolvedNavSection[];
  more: ResolvedNavSection[];
} {
  const top = sections.filter((section) => section.placement === "top");
  const bottom = sections.filter((section) => section.placement === "bottom");
  return { tabs: top.slice(0, PHONE_TAB_COUNT), more: [...top.slice(PHONE_TAB_COUNT), ...bottom] };
}

interface PhoneNavProps {
  sections: ResolvedNavSection[];
  activePage: ResolvedNavPage | undefined;
  badges: NavBadgeMap;
  user: { id?: number; name?: string; email?: string };
  brandThemed: boolean;
}

function pageCount(page: ResolvedNavPage, badges: NavBadgeMap): number {
  return page.badgeKey ? badges[page.badgeKey] ?? 0 : 0;
}

function sectionCount(section: ResolvedNavSection, badges: NavBadgeMap): number {
  return section.showBadgeSum
    ? section.pages.reduce((sum, page) => sum + pageCount(page, badges), 0)
    : 0;
}

const badgeLabel = (count: number) => count > 99 ? "99+" : String(count);
const tabName = (label: string, count: number) => count > 0 ? `${label}, ${badgeLabel(count)}` : label;

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn("min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-bold leading-4 text-destructive-foreground", className)}>
      {badgeLabel(count)}
    </span>
  );
}

function TabLabel({ icon: Icon, label, count }: { icon: LucideIcon; label: string; count: number }) {
  return (
    <>
      <span className="relative">
        <Icon className="size-5" aria-hidden="true" />
        <CountBadge count={count} className="absolute -right-2.5 -top-1.5" />
      </span>
      <span className="text-[11px] font-semibold leading-none">{label}</span>
    </>
  );
}

const tabClass = "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1.5 text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary aria-[current=page]:bg-primary/5 aria-[current=page]:text-primary";

export function PhoneNav({ sections, activePage, badges, user, brandThemed }: PhoneNavProps) {
  const { open: openJumpTo, isOpen: jumpToOpen } = useJumpTo();
  const [location] = useLocation();
  const search = useSearch();
  const sheetId = useId();
  const { tabs, more } = splitPhoneTabs(sections);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const selectedSection = tabs.find((section) => section.id === menu);
  const sheetOpen = menuOpen && (menu === "more" || selectedSection != null);
  const moreIsCurrent = more.some((section) => section.id === activePage?.sectionId);

  useEffect(() => setMenuOpen(false), [location, search]);

  useEffect(() => {
    if (!sheetOpen) return;
    // The sheet is portalled outside the phone wrapper's lg:hidden boundary.
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [sheetOpen]);

  const renderPageRows = (pages: ResolvedNavPage[]) => (
    <ul>
      {pages.map((page) => {
        const Icon = page.icon;
        return (
          <li key={page.id}>
            <Link
              href={page.href}
              aria-current={page.id === activePage?.id ? "page" : undefined}
              data-testid={`link-phone-page-${page.id}`}
              className="flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted aria-[current=page]:bg-primary/10 aria-[current=page]:font-semibold aria-[current=page]:text-primary"
              onClick={() => setMenuOpen(false)}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{page.label}</span>
              <CountBadge count={pageCount(page, badges)} />
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const renderMenuTab = (id: string, label: string, icon: LucideIcon, count: number, current: boolean) => (
    <button
      key={id}
      type="button"
      className={tabClass}
      aria-label={tabName(label, count)}
      aria-current={current ? "page" : undefined}
      aria-haspopup="dialog"
      aria-expanded={sheetOpen && menu === id}
      aria-controls={sheetOpen && menu === id ? sheetId : undefined}
      data-testid={`button-phone-tab-${id}`}
      onClick={(event) => {
        menuTrigger.current = event.currentTarget;
        setMenu(id);
        setMenuOpen(true);
      }}
    >
      <TabLabel icon={icon} label={label} count={count} />
    </button>
  );

  return (
    <>
      <header
        data-testid="phone-nav-header"
        className={cn(
          "flex h-14 min-w-0 items-center gap-2 border-b px-2 shadow-sm",
          brandThemed
            ? "border-white/10 bg-slate-900 bg-gradient-to-r from-slate-900 to-[hsl(var(--primary-dark))] text-white"
            : "border-slate-200 bg-white text-slate-900",
        )}
      >
        <Link
          href={sections[0]?.pages[0]?.href ?? "/"}
          className="flex size-11 shrink-0 items-center justify-center rounded-md"
          data-testid="link-phone-home"
        >
          <img src={irrigoProMark} alt="IrrigoPro" className="size-9 object-contain" />
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" data-testid="text-phone-page">
          {activePage?.label ?? "IrrigoPro"}
        </span>
        <button
          type="button"
          className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-black/10"
          aria-label="Jump to a page"
          aria-haspopup="dialog"
          aria-expanded={jumpToOpen}
          data-testid="button-phone-jump-to"
          onClick={openJumpTo}
        >
          <Search className="size-5" aria-hidden="true" />
        </button>
        {typeof user.id === "number" && <NotificationSystem userId={user.id} phone />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="grid size-11 shrink-0 place-items-center rounded-md hover:bg-black/10" aria-label="Account" data-testid="button-phone-account">
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary text-white">{user.name?.charAt(0) || "U"}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="break-words px-2 py-1.5">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">{user.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="min-h-11">
              <Link href="/user-profile" data-testid="link-phone-account">
                <UserIcon className="mr-2 size-4" aria-hidden="true" /> My Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 text-red-600" onSelect={clearSessionAndLogout} data-testid="button-phone-logout">
              <LogOut className="mr-2 size-4" aria-hidden="true" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <nav
        aria-label="Phone navigation"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white shadow-[0_-2px_12px_rgba(15,23,42,0.08)]"
      >
        {tabs.map((section) => {
          const current = activePage?.sectionId === section.id;
          const count = sectionCount(section, badges);
          if (section.pages.length !== 1) return renderMenuTab(section.id, section.railLabel, section.icon, count, current);
          return (
            <Link
              key={section.id}
              href={section.pages[0].href}
              className={tabClass}
              aria-label={tabName(section.railLabel, count)}
              aria-current={current ? "page" : undefined}
              data-testid={`link-phone-tab-${section.id}`}
            >
              <TabLabel icon={section.icon} label={section.railLabel} count={count} />
            </Link>
          );
        })}
        {more.length > 0 && renderMenuTab("more", "More", Ellipsis, more.reduce((sum, section) => sum + sectionCount(section, badges), 0), moreIsCurrent)}
      </nav>
      <Sheet open={sheetOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          id={sheetId}
          aria-describedby={undefined}
          side="bottom"
          className="flex max-h-[75vh] flex-col gap-0 rounded-t-2xl p-0 [&>button]:right-2 [&>button]:top-1 [&>button]:grid [&>button]:size-11 [&>button]:place-items-center"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            menuTrigger.current?.focus();
          }}
        >
          <SheetTitle className="border-b px-4 py-3 pr-14">{selectedSection?.label ?? "More"}</SheetTitle>
          <div className="pb-safe min-h-0 overflow-y-auto overscroll-contain">
            <div className="space-y-3 p-3">
              {selectedSection
                ? selectedSection.groups.map((group) => (
                    <div key={group.label ?? ""}>
                      {group.label && <h3 className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h3>}
                      {renderPageRows(group.pages)}
                    </div>
                  ))
                : more.map((section) => (
                    <div key={section.id}>
                      <h3 className="px-3 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{section.label}</h3>
                      {renderPageRows(section.pages)}
                    </div>
                  ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
