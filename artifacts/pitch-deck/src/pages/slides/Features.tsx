const base = import.meta.env.BASE_URL;

export default function Features() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-b from-bg to-[hsl(210_40%_95%)]" />

      <div
        className="absolute right-[2vw] bottom-[2vh] w-[20vw] h-[20vw] pointer-events-none select-none"
        style={{ opacity: 0.06 }}
      >
        <img src={`${base}logo-drop.png`} alt="" className="h-full w-full object-contain" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col px-[7vw] py-[5vh]">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[1.3vw] font-semibold uppercase tracking-[0.3em] text-primary">
              07 · Feature highlights
            </div>
            <h2 className="mt-[1vh] text-[3.6vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
              Everything an irrigation company runs on.
            </h2>
          </div>
          <p className="hidden lg:block max-w-[26vw] text-[1.45vw] font-normal text-muted text-pretty">
            Four purpose-built workflows keep estimates, field work,
            inspections, and billing connected — without rebuilding information
            at every handoff.
          </p>
        </div>

        <div className="mt-[3vh] grid flex-1 grid-cols-3 grid-rows-2 gap-[1.4vw]">
          <div className="rounded-[1vw] border border-border bg-surface p-[1.5vw] shadow-sm">
            <div className="inline-flex h-[2.2vw] w-[2.2vw] items-center justify-center rounded-[0.5vw] bg-primary/10 text-[1.1vw] font-extrabold text-primary">
              01
            </div>
            <div className="mt-[1vh] text-[1.65vw] font-extrabold text-text">
              Estimates that move work forward
            </div>
            <div className="mt-[0.7vh] text-[1.3vw] leading-snug text-muted">
              Build accurate proposals from your parts catalog and
              customer-specific labor rates. Send, review, approve, and convert
              accepted work into execution.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.5vw] shadow-sm">
            <div className="inline-flex h-[2.2vw] w-[2.2vw] items-center justify-center rounded-[0.5vw] bg-primary/10 text-[1.1vw] font-extrabold text-primary">
              02
            </div>
            <div className="mt-[1vh] text-[1.65vw] font-extrabold text-text">
              Work orders crews actually use
            </div>
            <div className="mt-[0.7vh] text-[1.3vw] leading-snug text-muted">
              Schedule and assign technicians, provide property and system
              context, and capture labor, materials, notes, and photos in the
              field.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.5vw] shadow-sm">
            <div className="inline-flex h-[2.2vw] w-[2.2vw] items-center justify-center rounded-[0.5vw] bg-primary/10 text-[1.1vw] font-extrabold text-primary">
              03
            </div>
            <div className="mt-[1vh] text-[1.65vw] font-extrabold text-text">
              Wet checks, built zone by zone
            </div>
            <div className="mt-[0.7vh] text-[1.3vw] leading-snug text-muted">
              Run standardized controller and zone inspections with structured
              findings, photos, repair recommendations, and a protected
              inspection history.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.5vw] shadow-sm">
            <div className="inline-flex h-[2.2vw] w-[2.2vw] items-center justify-center rounded-[0.5vw] bg-accent/15 text-[1.1vw] font-extrabold text-accent">
              04
            </div>
            <div className="mt-[1vh] text-[1.65vw] font-extrabold text-text">
              Digital billing sheets, not paper
            </div>
            <div className="mt-[0.7vh] text-[1.3vw] leading-snug text-muted">
              Review completed field work, confirm pricing, apply markup and
              tax, and prepare approved charges for QuickBooks/Aspire.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.5vw] shadow-sm">
            <div className="inline-flex h-[2.2vw] w-[2.2vw] items-center justify-center rounded-[0.5vw] bg-accent/15 text-[1.1vw] font-extrabold text-accent">
              05
            </div>
            <div className="mt-[1vh] text-[1.65vw] font-extrabold text-text">
              Site maps &amp; controllers
            </div>
            <div className="mt-[0.7vh] text-[1.3vw] leading-snug text-muted">
              Interactive maps connect properties, controllers, zones, and field
              activity in one operational view.
            </div>
          </div>
          <div className="rounded-[1vw] border border-border bg-surface p-[1.5vw] shadow-sm">
            <div className="inline-flex h-[2.2vw] w-[2.2vw] items-center justify-center rounded-[0.5vw] bg-accent/15 text-[1.1vw] font-extrabold text-accent">
              06
            </div>
            <div className="mt-[1vh] text-[1.65vw] font-extrabold text-text">
              Roles for every seat
            </div>
            <div className="mt-[0.7vh] text-[1.3vw] leading-snug text-muted">
              Give owners, managers, technicians, and billing teams the tools
              and visibility needed for their part of the workflow.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
