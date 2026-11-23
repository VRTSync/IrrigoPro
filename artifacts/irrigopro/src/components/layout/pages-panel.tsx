import { useId } from "react";
import { Star } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import type { NavBadgeMap, ResolvedNavPage, ResolvedNavSection } from "./nav-config";
import { NAV_PIN_LIMIT, type NavPins } from "./nav-pins";

interface PagesPanelProps {
  section: ResolvedNavSection;
  activePage: ResolvedNavPage | undefined;
  badges: NavBadgeMap;
  pins: NavPins;
}

export function PagesPanel({ section, activePage, badges, pins }: PagesPanelProps) {
  const titleId = useId();
  return (
    <nav
      aria-labelledby={titleId}
      data-testid="pages-panel"
      className="nav-panel sticky top-0 flex h-screen w-[240px] shrink-0 flex-col min-[1200px]:w-[280px]"
    >
      <header className="shrink-0 px-4 pb-2.5 pt-[18px]">
        <h2 id={titleId} className="text-lg font-bold leading-tight">{section.label}</h2>
        <p className="nav-panel-description mt-1 text-[13px] leading-snug">{section.description}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
        {section.groups.map(({ label, pages }) => (
          <div key={label ?? ""}>
            {label && (
              <h3 className="nav-panel-group px-2.5 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.08em]">{label}</h3>
            )}
            <ul>
              {pages.map((page) => {
                const count = page.badgeKey ? badges[page.badgeKey] ?? 0 : 0;
                const pinned = pins.isPinned(page.id);
                const disabled = pins.atLimit && !pinned;
                const active = page.id === activePage?.id;
                return (
                  <li key={page.id} data-active={active} className="nav-panel-row group flex items-center gap-1 rounded-[10px] py-0.5 pr-1">
                    <Link
                      href={page.href}
                      aria-label={page.label}
                      aria-current={active ? "page" : undefined}
                      aria-description={count > 0 ? `${count} outstanding` : undefined}
                      className="flex min-w-0 flex-1 items-center gap-1 rounded-[10px] py-2 pl-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-snug">{page.label}</span>
                        <span className="nav-panel-description mt-0.5 hidden text-xs leading-[1.35] min-[1200px]:block">{page.description}</span>
                      </span>
                      {count > 0 && (
                        <span aria-hidden="true" className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-red-700 px-1.5 text-[11px] font-bold text-white">
                          {count > 99 ? "99+" : count}
                        </span>
                      )}
                    </Link>
                    {page.id !== "dashboard" && (
                      <button
                        type="button"
                        aria-label={`${pinned ? "Unpin" : "Pin"} ${page.label}`}
                        aria-pressed={pinned}
                        disabled={disabled}
                        title={disabled ? `Up to ${NAV_PIN_LIMIT} pinned pages` : undefined}
                        onClick={() => pins.toggle(page.id)}
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-lg hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-slate-400",
                          pinned ? "text-amber-700" : "text-slate-500 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
                        )}
                      >
                        <Star aria-hidden="true" className={cn("size-4", pinned && "fill-current")} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
