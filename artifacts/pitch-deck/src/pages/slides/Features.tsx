export default function Features() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-b from-bg to-[hsl(210_40%_95%)]" />

      <div className="relative z-10 flex h-full w-full flex-col px-[7vw] py-[7vh]">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-primary">
              07 · Feature highlights
            </div>
            <h2 className="mt-[1.5vh] text-[4.4vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
              Everything an irrigation company runs on.
            </h2>
          </div>
          <p className="hidden lg:block max-w-[26vw] text-[1.55vw] font-normal text-muted text-pretty">
            One app replaces the patchwork of spreadsheets, text threads, and paper tickets.
          </p>
        </div>

        <div className="mt-[5vh] grid flex-1 grid-cols-3 grid-rows-2 gap-[1.8vw]">
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-primary/10 text-[1.3vw] font-extrabold text-primary">
              01
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Estimates that close faster
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Parts catalog, customer-specific labor rates, PDF + email built in.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-primary/10 text-[1.3vw] font-extrabold text-primary">
              02
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Work orders crews actually use
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Per-zone notes, technician scheduling, offline-safe field app.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-primary/10 text-[1.3vw] font-extrabold text-primary">
              03
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Wet checks, by the zone
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Standardized inspections with immutable findings and auto-billing.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-accent/15 text-[1.3vw] font-extrabold text-accent">
              04
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Billing sheets, not spreadsheets
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Authoritative pricing, markup, tax, and reprice history.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-accent/15 text-[1.3vw] font-extrabold text-accent">
              05
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Site maps &amp; controllers
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Interactive maps with controller and zone management on every job.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-accent/15 text-[1.3vw] font-extrabold text-accent">
              06
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Roles for every seat
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Field tech, manager, billing manager, admin — with audit trails.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
