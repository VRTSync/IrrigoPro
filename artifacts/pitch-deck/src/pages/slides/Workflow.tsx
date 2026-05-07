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
              Estimate. Schedule. Service. Invoice.
            </h2>
          </div>
          <p className="hidden lg:block max-w-[28vw] text-[1.6vw] font-normal text-muted text-pretty">
            One thread that ties the office to the field — and the field back
            to your accountant.
          </p>
        </div>

        <div className="mt-[6vh] grid flex-1 grid-cols-4 gap-[2vw]">
          <div className="relative flex flex-col rounded-[1.2vw] border border-border bg-surface p-[2vw] shadow-sm">
            <div className="absolute -top-[1.6vh] left-[1.6vw] rounded-full bg-primary px-[1vw] py-[0.4vh] text-[1.1vw] font-extrabold uppercase tracking-wider text-white">
              Step 01
            </div>
            <div className="mt-[1.5vh] text-[2.4vw] font-extrabold tracking-tight text-text">
              Estimate
            </div>
            <p className="mt-[1.5vh] text-[1.55vw] font-normal leading-snug text-muted">
              Build it from your parts catalog and customer labor rates. Send
              for review. Capture customer approval from a phone.
            </p>
            <div className="mt-auto pt-[2vh] text-[1.3vw] font-semibold uppercase tracking-wider text-primary">
              Draft → Sent → Approved
            </div>
          </div>

          <div className="relative flex flex-col rounded-[1.2vw] border border-border bg-surface p-[2vw] shadow-sm">
            <div className="absolute -top-[1.6vh] left-[1.6vw] rounded-full bg-primary px-[1vw] py-[0.4vh] text-[1.1vw] font-extrabold uppercase tracking-wider text-white">
              Step 02
            </div>
            <div className="mt-[1.5vh] text-[2.4vw] font-extrabold tracking-tight text-text">
              Schedule
            </div>
            <p className="mt-[1.5vh] text-[1.55vw] font-normal leading-snug text-muted">
              Convert approved estimates into work orders, assign technicians,
              and share the site map and zone history.
            </p>
            <div className="mt-auto pt-[2vh] text-[1.3vw] font-semibold uppercase tracking-wider text-primary">
              Dispatch &amp; site maps
            </div>
          </div>

          <div className="relative flex flex-col rounded-[1.2vw] border border-border bg-surface p-[2vw] shadow-sm">
            <div className="absolute -top-[1.6vh] left-[1.6vw] rounded-full bg-primary px-[1vw] py-[0.4vh] text-[1.1vw] font-extrabold uppercase tracking-wider text-white">
              Step 03
            </div>
            <div className="mt-[1.5vh] text-[2.4vw] font-extrabold tracking-tight text-text">
              Field
            </div>
            <p className="mt-[1.5vh] text-[1.55vw] font-normal leading-snug text-muted">
              Crew captures parts used, labor, and zone-by-zone wet-check
              findings — with photos, even when offline.
            </p>
            <div className="mt-auto pt-[2vh] text-[1.3vw] font-semibold uppercase tracking-wider text-primary">
              Wet checks &amp; photos
            </div>
          </div>

          <div className="relative flex flex-col rounded-[1.2vw] border-2 border-accent bg-surface p-[2vw] shadow-md">
            <div className="absolute -top-[1.6vh] left-[1.6vw] rounded-full bg-accent px-[1vw] py-[0.4vh] text-[1.1vw] font-extrabold uppercase tracking-wider text-white">
              Step 04
            </div>
            <div className="mt-[1.5vh] text-[2.4vw] font-extrabold tracking-tight text-text">
              Invoice
            </div>
            <p className="mt-[1.5vh] text-[1.55vw] font-normal leading-snug text-muted">
              Completed jobs flow into a billing sheet, then push straight to
              QuickBooks Online as a polished invoice.
            </p>
            <div className="mt-auto pt-[2vh] text-[1.3vw] font-semibold uppercase tracking-wider text-accent">
              One click to QuickBooks
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
