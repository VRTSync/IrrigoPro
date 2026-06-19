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
            Four purpose-built workflows keep estimates, field work,
            inspections, and billing connected — without rebuilding information
            at every handoff.
          </p>
        </div>

        <div className="mt-[5vh] grid flex-1 grid-cols-3 grid-rows-2 gap-[1.8vw]">
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-primary/10 text-[1.3vw] font-extrabold text-primary">
              01
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Estimates that move work forward
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Build accurate proposals from your parts catalog and
              customer-specific labor rates. Send, review, approve, and convert
              accepted work into execution.
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
              Schedule and assign technicians, provide property and system
              context, and capture labor, materials, notes, and photos in the
              field.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-primary/10 text-[1.3vw] font-extrabold text-primary">
              03
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Wet checks, built zone by zone
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Run standardized controller and zone inspections with structured
              findings, photos, repair recommendations, and a protected
              inspection history.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="inline-flex h-[2.6vw] w-[2.6vw] items-center justify-center rounded-[0.6vw] bg-accent/15 text-[1.3vw] font-extrabold text-accent">
              04
            </div>
            <div className="mt-[1.4vh] text-[1.85vw] font-extrabold text-text">
              Digital billing sheets, not paper
            </div>
            <div className="mt-[1vh] text-[1.45vw] leading-snug text-muted">
              Review completed field work, confirm pricing, apply markup and
              tax, and prepare approved charges for QuickBooks/Aspire.
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
              Interactive maps connect properties, controllers, zones, and field
              activity in one operational view.
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
              Give owners, managers, technicians, and billing teams the tools
              and visibility needed for their part of the workflow.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
