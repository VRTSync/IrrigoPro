import { lazy, Suspense } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { User } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clearSessionAndLogout } from "@/lib/queryClient";
import DocPropertyPickerPage from "@/pages/document-system/DocPropertyPickerPage";
import DocumentSystemPage from "@/pages/customers/DocumentSystemPage";

// SwitchUser signs restricted accounts out before mounting its staff user list.
const SwitchUser = lazy(() => import("@/pages/switch-user"));

export interface DocumenterAppProps {
  user: { name?: string | null };
}

/**
 * Slice 7 — the System Documenter's whole app: picker, wizard, Switch User.
 * Deliberately no Navigation, DesktopShell, notifications or footer: each
 * fetches data or links to screens this role cannot use.
 */
export default function DocumenterApp({ user }: DocumenterAppProps) {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen bg-background" data-testid="documenter-app">
      <header
        className="h-[68px] px-3 flex items-center gap-2.5 bg-gradient-to-r from-primary-dark to-primary text-white"
        // primary-dark is a CSS token but not a registered Tailwind colour.
        // Keep this local: registering it globally would restyle staff screens.
        style={{ backgroundImage: "linear-gradient(to right, hsl(var(--primary-dark)), hsl(var(--primary)))" }}
      >
        <h1 className="flex-1 min-w-0 truncate text-[17px] font-semibold" data-testid="text-documenter-title">System Documenter</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account"
              className="h-11 w-11 rounded-xl bg-white/15 flex items-center justify-center hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              data-testid="button-account"
            >
              <User className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal text-slate-600" data-testid="text-signed-in-as">Signed in as {user.name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="min-h-11" onSelect={() => setLocation("/switch-user")} data-testid="menu-switch-user">Switch User</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 text-red-600 focus:text-red-700" onSelect={() => clearSessionAndLogout()} data-testid="menu-log-out">Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main>
        <Suspense fallback={<div className="mx-auto w-full max-w-[480px] p-4"><div className="h-[84px] rounded-xl skeleton-shimmer" /></div>}>
          <Switch>
            <Route path="/" component={DocPropertyPickerPage} />
            <Route path="/customers/:customerId/document-system">{() => <DocumentSystemPage variant="documenter" />}</Route>
            <Route path="/switch-user" component={SwitchUser} />
            <Route><Redirect to="/" /></Route>
          </Switch>
        </Suspense>
      </main>
    </div>
  );
}
