import { LogOut, User as UserIcon } from "lucide-react";
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
}

export function NavRail({ sections, activePage, badges, brandThemed, user, onSelectSection }: NavRailProps) {
  const top = sections.filter(({ placement }) => placement === "top");
  const bottom = sections.filter(({ placement }) => placement === "bottom");

  function sectionButton(section: ResolvedNavSection) {
    const Icon = section.icon;
    const sum = section.showBadgeSum
      ? section.pages.reduce((total, { badgeKey }) => total + (badgeKey ? badges[badgeKey] ?? 0 : 0), 0)
      : 0;
    return (
      <button
        key={section.id}
        type="button"
        aria-label={section.railLabel}
        aria-description={sum > 0 ? `${sum} outstanding` : undefined}
        aria-current={activePage?.sectionId === section.id ? "true" : undefined}
        onClick={() => onSelectSection(section.id)}
        className="nav-rail-section relative flex min-h-14 w-[60px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold leading-tight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Icon className="size-5" aria-hidden="true" />
        {section.railLabel}
        {sum > 0 && (
          <span
            aria-hidden="true"
            data-testid={`nav-rail-badge-${section.id}`}
            className="absolute right-[9px] top-[5px] min-w-4 rounded-full bg-red-700 px-1 text-center text-[10px] font-bold leading-4 text-white"
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
      className={cn("nav-rail sticky top-0 flex h-screen w-[76px] shrink-0 flex-col items-center border-r py-3", brandThemed && "nav-rail-brand")}
    >
      <Link
        href={sections[0]?.pages[0]?.href ?? "/"}
        className="mb-[14px] grid size-10 shrink-0 place-items-center rounded-xl focus-visible:outline focus-visible:outline-2"
      >
        <img src={irrigoProMark} alt="IrrigoPro" className="size-10 object-contain" />
      </Link>
      <div className="flex flex-col gap-1">{top.map(sectionButton)}</div>
      <div className="mt-auto flex flex-col gap-1" data-testid="nav-rail-bottom">{bottom.map(sectionButton)}</div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account"
            title={user.name || "Account"}
            className="mt-3 grid size-9 shrink-0 place-items-center rounded-[10px] focus-visible:outline focus-visible:outline-2"
          >
            <Avatar className="size-9 rounded-[10px]">
              <AvatarFallback className="nav-rail-avatar rounded-[10px] bg-primary font-bold text-white">
                {user.name?.charAt(0) || "U"}
              </AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={12} className="w-56">
          {user.name && (
            <div className="break-words px-2 py-1.5">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-xs capitalize text-muted-foreground">{user.role?.replace(/_/g, " ")}</p>
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
    </nav>
  );
}
