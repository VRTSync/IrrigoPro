export default function Problem() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-[hsl(210_40%_94%)]" />
      <div className="absolute -right-[10vw] -top-[10vw] h-[40vw] w-[40vw] rounded-full bg-primary/5 blur-3xl" />

      <div className="relative z-10 grid h-full w-full grid-cols-12 gap-[3vw] px-[7vw] py-[6vh]">
        <div className="col-span-7 flex flex-col justify-center">
          <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-primary">
            02 · The Problem
          </div>
          <h2 className="mt-[2vh] text-[4.6vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
            Irrigation companies still run on paper, texts, and spreadsheets.
          </h2>
          <p className="mt-[2.5vh] max-w-[42vw] text-[1.9vw] font-normal leading-snug text-muted text-pretty">
            Estimates live in separate documents. Work orders are managed
            through texts and phone calls. Wet-check findings come back through
            notes and photos. Billing teams then chase down the missing details
            and rebuild the job in QuickBooks.
          </p>
        </div>

        <div className="col-span-5 flex flex-col justify-center gap-[1.6vh]">
          <div className="rounded-[1.2vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="text-[3vw] font-extrabold leading-none text-primary">
              4+
            </div>
            <div className="mt-[0.8vh] text-[1.5vw] font-semibold text-text">
              Disconnected tools per job
            </div>
            <div className="text-[1.35vw] text-muted">
              Documents, texts, photos, paper tickets, and accounting software.
            </div>
          </div>
          <div className="rounded-[1.2vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="text-[3vw] font-extrabold leading-none text-primary">
              Days
            </div>
            <div className="mt-[0.8vh] text-[1.5vw] font-semibold text-text">
              From completed work to a sent invoice
            </div>
            <div className="text-[1.35vw] text-muted">
              Manual review and re-entry slow down cash flow.
            </div>
          </div>
          <div className="rounded-[1.2vw] border border-border bg-surface p-[1.8vw] shadow-sm">
            <div className="text-[3vw] font-extrabold leading-none text-primary">
              Limited
            </div>
            <div className="mt-[0.8vh] text-[1.5vw] font-semibold text-text">
              Visibility when pricing is questioned
            </div>
            <div className="text-[1.35vw] text-muted">
              It is often difficult to see what changed, who changed it, and why.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
