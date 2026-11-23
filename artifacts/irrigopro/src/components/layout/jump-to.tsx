import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navForRole, type ResolvedNavSection } from "./nav-config";

interface JumpToContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

export const JumpToContext = createContext<JumpToContextValue | null>(null);

export function useJumpTo(): JumpToContextValue {
  const context = useContext(JumpToContext);
  if (!context) throw new Error("useJumpTo must be used within a JumpToProvider");
  return context;
}

// Equal scores keep matching pages in page order, rather than re-ranking them.
function filterPage(_id: string, query: string, keywords: string[] = []): number {
  const search = query.trim().toLowerCase();
  return keywords.some((keyword) => keyword.toLowerCase().includes(search)) ? 1 : 0;
}

export function JumpToProvider({ role, children }: { role: string | undefined; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const context = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);
  const sections = useMemo(() => navForRole(role), [role]);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (!event.repeat) setIsOpen((current) => !current);
    };
    // Capture the shortcut even in fields that stop bubbling key events.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <JumpToContext.Provider value={context}>
      {children}
      <CommandDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        title="Jump to a page"
        commandProps={{ filter: filterPage, vimBindings: false }}
        onOpenAutoFocus={() => {
          previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          previousFocus.current?.focus();
        }}
      >
        <JumpToPages sections={sections} onSelect={(href) => {
          navigate(href);
          close();
        }} />
      </CommandDialog>
    </JumpToContext.Provider>
  );
}

function JumpToPages({ sections, onSelect }: {
  sections: ResolvedNavSection[];
  onSelect: (href: string) => void;
}) {
  const [query, setQuery] = useState("");

  return (
    <>
      <CommandInput
        placeholder="Type a page name..."
        className="pr-12"
        data-testid="input-jump-to-page"
        onValueChange={setQuery}
      />
      <CommandList label="Pages" className="max-h-[min(300px,calc(95dvh-3rem))]">
        <CommandEmpty data-testid="text-jump-to-empty">
          {`No page matches "${query}".`}
        </CommandEmpty>
        {sections.map((section) => (
          // Keep each group in its own parent so cmdk can't reorder the sections.
          <div key={section.id}>
            <CommandGroup heading={section.label} value={section.id}>
              {section.pages.map((page) => (
                <CommandItem
                  key={page.id}
                  value={page.id}
                  keywords={[page.label, section.label, page.description]}
                  data-testid={`option-jump-to-${page.id}`}
                  onSelect={() => onSelect(page.href)}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{page.label}</p>
                    <p className="text-xs text-muted-foreground">{page.description}</p>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}
      </CommandList>
    </>
  );
}
