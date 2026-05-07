import { useState } from "react";
import { Link } from "wouter";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_LOGIN_URL } from "@/lib/links";

const NAV_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Demo", href: "#demo" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5" data-testid="link-home">
          <img
            src="/marketing/irrigopro-logo.png"
            alt="IrrigoPro"
            className="h-8 w-8 rounded-md object-contain"
          />
          <span className="text-base font-bold tracking-tight text-foreground">
            IrrigoPro
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid={`nav-${l.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <a href={APP_LOGIN_URL}>
            <Button
              variant="ghost"
              className="text-foreground hover:text-primary"
              data-testid="button-signin"
            >
              Sign in
            </Button>
          </a>
          <a href="#demo">
            <Button className="brand-gradient text-white shadow-md" data-testid="button-cta-nav">
              Request a demo
            </Button>
          </a>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          data-testid="button-menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-border/60 bg-background md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
                onClick={() => setOpen(false)}
              >
                {l.label}
              </a>
            ))}
            <a
              href={APP_LOGIN_URL}
              className="rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary"
            >
              Sign in
            </a>
            <a href="#demo" onClick={() => setOpen(false)}>
              <Button className="brand-gradient mt-2 w-full text-white">
                Request a demo
              </Button>
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}
