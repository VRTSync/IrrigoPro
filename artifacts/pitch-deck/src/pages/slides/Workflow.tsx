export default function Workflow() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-b from-bg to-[hsl(210_40%_95%)]" />

      <div className="relative z-10 flex h-full w-full flex-col px-[7vw] py-[7vh]">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-primary">
              04 · How it works
            </div>
            <h2 className="mt-[1.5vh] text-[4.6vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
              Four ticket types. One connected platform.
            </h2>
          </div>
          <p className="hidden lg:block max-w-[28vw] text-[1.6vw] font-normal text-muted text-pretty">
            Estimates, work orders, wet checks, and billing sheets each serve a
            distinct purpose — and all share the same property, customer, and
            job history.
          </p>
        </div>

        <div className="mt-[6vh] grid flex-1 grid-cols-4 gap-[2vw]">
          <div className="relative flex flex-col rounded-[1.2vw] border border-border bg-surface p-[2vw] shadow-sm">
            <div className="absolute -top-[1.6vh] left-[1.6vw] rounded-full bg-primary px-[1vw] py-[0.4vh] text-[1.1vw] font-extrabold uppercase tracking-wider text-white">
              Ticket 01
            </div>
            <div className="mt-[1.5vh] text-[2.4vw] font-extrabold tracking-tight text-text">
              Estimate
            </div>
            <p className="mt-[1.5vh] text-[1.55vw] font-normal leading-snug text-muted">
              Build proposed work from your parts catalog and customer labor
              rates. Send for review and capture approval from a phone.
            </p>
            <div className="mt-auto pt-[2vh] text-[1.3vw] font-semibold uppercase tracking-wider text-primary">
              Draft → Sent → Approved
            </div>
          </div>

          <div className="relative flex flex-col rounded-[1.2vw] border border-border bg-surface p-[2vw] shadow-sm">
            <div className="absolute -top-[1.6vh] left-[1.6vw] rounded-full bg-primary px-[1vw] py-[0.4vh] text-[1.1vw] font-extrabold uppercase tracking-wider text-white">
              Ticket 02
            </div>
            <div className="mt-[1.5vh] text-[2.4vw] font-extrabold tracking-tight text-text">
              Work Order
            </div>
            <p className="mt-[1.5vh] text-[1.55vw] font-normal leading-snug text-muted">
              Schedule and assign field work, attach the site map and system
              history, and give the technician the exact scope needed to
              complete the job.
            </p>
            <div className="mt-auto pt-[2vh] text-[1.3vw] font-semibold uppercase tracking-wider text-primary">
              Scheduled → In Progress → Complete
            </div>
          </div>

          <div className="relative flex flex-col rounded-[1.2vw] border border-border bg-surface p-[2vw] shadow-sm">
            <div className="absolute -top-[1.6vh] left-[1.6vw] rounded-full bg-primary px-[1vw] py-[0.4vh] text-[1.1vw] font-extrabold uppercase tracking-wider text-white">
              Ticket 03
            </div>
            <div className="mt-[1.5vh] text-[2.4vw] font-extrabold tracking-tight text-text">
              Wet Check
            </div>
            <p className="mt-[1.5vh] text-[1.55vw] font-normal leading-snug text-muted">
              Inspect controllers and zones with a structured field workflow.
              Capture findings, parts, notes, and photos — even when offline.
            </p>
            <div className="mt-auto pt-[2vh] text-[1.3vw] font-semibold uppercase tracking-wider text-primary">
              Controller &amp; Zone Findings
            </div>
          </div>

          <div className="relative flex flex-col rounded-[1.2vw] border border-border bg-surface p-[2vw] shadow-sm">
            <div className="absolute -top-[1.6vh] left-[1.6vw] rounded-full bg-primary px-[1vw] py-[0.4vh] text-[1.1vw] font-extrabold uppercase tracking-wider text-white">
              Ticket 04
            </div>
            <div className="mt-[1.5vh] text-[2.4vw] font-extrabold tracking-tight text-text">
              Billing Sheet
            </div>
            <p className="mt-[1.5vh] text-[1.55vw] font-normal leading-snug text-muted">
              Review completed work, apply office-controlled pricing, markup,
              and tax, then send approved billing into QuickBooks/Aspire.
            </p>
            <div className="mt-auto pt-[2vh] text-[1.3vw] font-semibold uppercase tracking-wider text-primary">
              Review → Approve → Sync
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
