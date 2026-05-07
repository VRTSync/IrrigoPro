export default function Problem() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-[hsl(210_40%_94%)]" />
      <div className="absolute -right-[10vw] -top-[10vw] h-[40vw] w-[40vw] rounded-full bg-primary/5 blur-3xl" />

      <div className="relative z-10 grid h-full w-full grid-cols-12 gap-[3vw] px-[7vw] py-[8vh]">
        <div className="col-span-7 flex flex-col justify-center">
          <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-primary">
            02 · The Problem
          </div>
          <h2 className="mt-[2.5vh] text-[5vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
            Irrigation companies still run on paper, texts, and spreadsheets.
          </h2>
          <p className="mt-[3vh] max-w-[42vw] text-[2.1vw] font-normal leading-snug text-muted text-pretty">
            Estimates live in a Google Doc. Work orders are a group text.
            Wet-check findings come back on a napkin. Billing managers chase
            crews for the details, then re-key everything into QuickBooks.
          </p>
        </div>

        <div className="col-span-5 flex flex-col justify-center gap-[2.4vh]">
          <div className="rounded-[1.2vw] border border-border bg-surface p-[2.2vw] shadow-sm">
            <div className="text-[3.6vw] font-extrabold leading-none text-primary">
              4+
            </div>
            <div className="mt-[1vh] text-[1.6vw] font-semibold text-text">
              Disconnected tools per job
            </div>
            <div className="text-[1.5vw] text-muted">
              Docs, texts, photos, paper tickets, accounting.
            </div>
          </div>
          <div className="rounded-[1.2vw] border border-border bg-surface p-[2.2vw] shadow-sm">
            <div className="text-[3.6vw] font-extrabold leading-none text-primary">
              Days
            </div>
            <div className="mt-[1vh] text-[1.6vw] font-semibold text-text">
              From job complete to invoice sent
            </div>
            <div className="text-[1.5vw] text-muted">
              Re-keying line items costs real cash flow.
            </div>
          </div>
          <div className="rounded-[1.2vw] border border-border bg-surface p-[2.2vw] shadow-sm">
            <div className="text-[3.6vw] font-extrabold leading-none text-primary">
              0
            </div>
            <div className="mt-[1vh] text-[1.6vw] font-semibold text-text">
              Audit trail when pricing is disputed
            </div>
            <div className="text-[1.5vw] text-muted">
              Who changed the price? Nobody can say.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
