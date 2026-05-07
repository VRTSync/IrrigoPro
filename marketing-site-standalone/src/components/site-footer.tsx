import { APP_LOGIN_URL } from "@/lib/links";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center lg:px-8">
        <div className="flex items-center gap-2.5">
          <img
            src="/irrigopro-logo.png"
            alt="IrrigoPro"
            className="h-8 w-8 rounded-md object-contain"
          />
          <div>
            <div className="text-sm font-bold text-foreground">IrrigoPro</div>
            <div className="text-xs text-muted-foreground">
              Irrigation business, streamlined.
            </div>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <a href="#features" className="hover:text-foreground">Features</a>
          <a href="#how-it-works" className="hover:text-foreground">How it works</a>
          <a href="#demo" className="hover:text-foreground">Request demo</a>
          <a href={APP_LOGIN_URL} className="hover:text-foreground">Sign in</a>
        </nav>
        <div className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} IrrigoPro. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
