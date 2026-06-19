const base = import.meta.env.BASE_URL;

export default function WhoFor() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-b from-bg to-[hsl(210_40%_95%)]" />

      <div
        className="absolute right-[2vw] top-[4vh] w-[22vw] h-[22vw] pointer-events-none select-none"
        style={{ opacity: 0.06 }}
      >
        <img src={`${base}logo-drop.png`} alt="" className="h-full w-full object-contain" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col px-[7vw] py-[8vh]">
        <div>
          <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-primary">
            09 · Who it&apos;s for
          </div>
          <h2 className="mt-[1.5vh] max-w-[60vw] text-[4.6vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
            Built for the people who run the work.
          </h2>
          <p className="mt-[2.5vh] max-w-[50vw] text-[1.8vw] font-normal leading-snug text-muted text-pretty">
            IrrigoPro gives every role the right tools for their part of the
            operation — from company oversight and scheduling to field
            execution, billing, and accounting integration.
          </p>
        </div>

        <div className="mt-[6vh] grid flex-1 grid-cols-4 gap-[1.6vw]">
          <div className="flex flex-col rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="text-[1.3vw] font-extrabold uppercase tracking-[0.2em] text-primary">
              Owners &amp; Admins
            </div>
            <div className="mt-[1.5vh] text-[1.75vw] font-extrabold text-text">
              The whole company
            </div>
            <p className="mt-[1.2vh] text-[1.4vw] leading-snug text-muted">
              Manage users, customers, service locations, pricing, and
              company-wide operational visibility.
            </p>
          </div>
          <div className="flex flex-col rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="text-[1.3vw] font-extrabold uppercase tracking-[0.2em] text-primary">
              Irrigation Managers
            </div>
            <div className="mt-[1.5vh] text-[1.75vw] font-extrabold text-text">
              Schedule &amp; coordinate
            </div>
            <p className="mt-[1.2vh] text-[1.4vw] leading-snug text-muted">
              Create estimates, schedule work orders, assign technicians, launch
              wet checks, and monitor field progress.
            </p>
          </div>
          <div className="flex flex-col rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="text-[1.3vw] font-extrabold uppercase tracking-[0.2em] text-accent">
              Field Techs
            </div>
            <div className="mt-[1.5vh] text-[1.75vw] font-extrabold text-text">
              On the truck
            </div>
            <p className="mt-[1.2vh] text-[1.4vw] leading-snug text-muted">
              Complete mobile work orders and wet checks, capture labor,
              materials, notes, and photos, and sync completed work from the
              field.
            </p>
          </div>
          <div className="flex flex-col rounded-[1vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="text-[1.3vw] font-extrabold uppercase tracking-[0.2em] text-accent">
              Billing Managers
            </div>
            <div className="mt-[1.5vh] text-[1.75vw] font-extrabold text-text">
              Review &amp; invoice
            </div>
            <p className="mt-[1.2vh] text-[1.4vw] leading-snug text-muted">
              Review digital billing sheets, confirm pricing and revisions, and
              send approved billing into QuickBooks/Aspire.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
