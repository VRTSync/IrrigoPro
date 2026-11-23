import { ChevronsLeft, LogOut, User as UserIcon } from "lucide-react";
import { Link } from "wouter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearSessionAndLogout } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import irrigoProMark from "@assets/IrrigoPro_2026-05_1778193170303.png";
import type { NavBadgeMap, ResolvedNavPage, ResolvedNavSection } from "./nav-config";

interface NavRailProps {
  sections: ResolvedNavSection[];
  activePage: ResolvedNavPage | undefined;
  badges: NavBadgeMap;
  brandThemed: boolean;
  user: { name?: string; role?: string };
  onSelectSection(sectionId: string): void;
  expanded: boolean;
  onCollapse(): void;
}

const wideRow = "nav-rail-wide-row flex w-full shrink-0 items-center gap-2.5 px-2.5 text-left text-sm font-semibold";
const focusOutline = "focus-visible:outline focus-visible:outline-2";

export function NavRail({ sections, activePage, badges, brandThemed, user, onSelectSection, expanded, onCollapse }: NavRailProps) {
  const top = sections.filter(({ placement }) => placement === "top");
  const bottom = sections.filter(({ placement }) => placement === "bottom");
  const roleLabel = user.role?.replace(/_/g, " ");

  function sectionButton(section: ResolvedNavSection) {
    const Icon = section.icon;
    const sum = section.showBadgeSum
      ? section.pages.reduce((total, { badgeKey }) => total + (badgeKey ? badges[badgeKey] ?? 0 : 0), 0)
      : 0;
    return (
      <button
        key={section.id}
        type="button"
        aria-label={expanded ? section.label : section.railLabel}
        aria-description={sum > 0 ? `${sum} outstanding` : undefined}
        aria-current={activePage?.sectionId === section.id ? "true" : undefined}
        onClick={() => onSelectSection(section.id)}
        className={cn(
          "nav-rail-section relative focus-visible:outline-offset-2", focusOutline,
          expanded ? wideRow : "flex min-h-14 w-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold leading-tight",
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        {expanded ? <span className="truncate">{section.label}</span> : section.railLabel}
        {sum > 0 && (
          <span
            aria-hidden="true"
            data-testid={`nav-rail-badge-${section.id}`}
            className={cn(
              "min-w-4 rounded-full bg-red-700 px-1 text-center text-[10px] font-bold leading-4 text-white",
              expanded ? "ml-auto shrink-0" : "absolute right-[9px] top-[5px]",
            )}
          >
            {sum > 99 ? "99+" : sum}
          </span>
        )}
      </button>
    );
  }

  return (
    <nav
      aria-label="Desktop sections"
      className={cn(
        "nav-rail sticky top-0 flex h-screen shrink-0 flex-col border-r py-3 transition-[width] duration-150 motion-reduce:transition-none",
        expanded ? "w-[216px] px-2" : "w-[76px] items-center",
        brandThemed && "nav-rail-brand",
      )}
    >
      <Link
        href={sections[0]?.pages[0]?.href ?? "/"}
        className={cn(
          "mb-[14px] shrink-0 rounded-xl", focusOutline,
          expanded ? "flex h-10 items-center gap-2.5 whitespace-nowrap px-2.5 text-lg font-bold" : "grid size-10 place-items-center",
          expanded && brandThemed && "text-white",
        )}
      >
        <img src={irrigoProMark} alt={expanded ? "" : "IrrigoPro"} className="size-10 shrink-0 object-contain" />
        {expanded && <span className="truncate">IrrigoPro</span>}
      </Link>
      <div className="flex flex-col gap-1">{top.map(sectionButton)}</div>
      <div className={cn("mt-auto flex flex-col", expanded ? "nav-rail-wide-bottom gap-1 border-t pt-2" : "items-center")}>
        <div className="flex flex-col gap-1" data-testid="nav-rail-bottom">{bottom.map(sectionButton)}</div>
        {expanded && (
          <button
            type="button"
            className={cn("nav-rail-section", wideRow, focusOutline)}
            data-testid="button-collapse-main-menu"
            onClick={onCollapse}
          >
            <ChevronsLeft className="size-5 shrink-0" aria-hidden="true" />
            Collapse menu
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account"
              title={user.name || "Account"}
              className={cn(
                focusOutline,
                expanded ? cn("nav-rail-section min-w-0 py-1", wideRow) : "mt-3 grid size-9 shrink-0 place-items-center rounded-[10px]",
              )}
            >
              <Avatar className="size-9 shrink-0 rounded-[10px]">
                <AvatarFallback className="nav-rail-avatar rounded-[10px] bg-primary font-bold text-white">
                  {user.name?.charAt(0) || "U"}
                </AvatarFallback>
              </Avatar>
              {expanded && (
                <span className="min-w-0">
                  <span className="block truncate">{user.name || "Account"}</span>
                  {roleLabel && <span className="block truncate text-xs font-normal capitalize">{roleLabel}</span>}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" sideOffset={12} className="w-56">
            {user.name && (
              <div className="break-words px-2 py-1.5">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs capitalize text-muted-foreground">{roleLabel}</p>
              </div>
            )}
            <DropdownMenuItem asChild>
              <Link href="/user-profile">
                <UserIcon className="mr-2 size-4" aria-hidden="true" /> My Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={clearSessionAndLogout} className="text-red-600">
              <LogOut className="mr-2 size-4" aria-hidden="true" /> Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
