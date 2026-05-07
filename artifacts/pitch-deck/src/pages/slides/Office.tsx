export default function Office() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-[hsl(210_40%_94%)]" />

      <div className="relative z-10 grid h-full w-full grid-cols-12 gap-[3vw] px-[7vw] py-[8vh]">
        <div className="col-span-6 flex flex-col justify-center gap-[2vh]">
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[2vw] shadow-sm">
            <span className="mt-[0.4vh] inline-flex h-[3vw] w-[3vw] flex-none items-center justify-center rounded-[0.7vw] bg-primary/10 text-[1.6vw] font-extrabold text-primary">
              01
            </span>
            <div>
              <div className="text-[1.9vw] font-extrabold text-text">
                Server-authoritative pricing
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                Markup, tax, and labor rates live on the server — not in a spreadsheet.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[2vw] shadow-sm">
            <span className="mt-[0.4vh] inline-flex h-[3vw] w-[3vw] flex-none items-center justify-center rounded-[0.7vw] bg-primary/10 text-[1.6vw] font-extrabold text-primary">
              02
            </span>
            <div>
              <div className="text-[1.9vw] font-extrabold text-text">
                Reprice with full audit history
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                Every change to a billing sheet is signed, dated, and recoverable.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[2vw] shadow-sm">
            <span className="mt-[0.4vh] inline-flex h-[3vw] w-[3vw] flex-none items-center justify-center rounded-[0.7vw] bg-primary/10 text-[1.6vw] font-extrabold text-primary">
              03
            </span>
            <div>
              <div className="text-[1.9vw] font-extrabold text-text">
                Photos attached to every line
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                When a customer disputes a charge, the answer is one click away.
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-6 flex flex-col justify-center">
          <div className="inline-flex items-center gap-[0.8vw]">
            <span className="rounded-full bg-accent/15 px-[1vw] py-[0.5vh] text-[1.2vw] font-extrabold uppercase tracking-[0.25em] text-accent">
              Office
            </span>
            <span className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-muted">
              06
            </span>
          </div>
          <h2 className="mt-[2.5vh] text-[4.6vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
            Billing managers in control.
          </h2>
          <p className="mt-[3vh] max-w-[40vw] text-[1.9vw] font-normal leading-snug text-muted text-pretty">
            Authoritative pricing on the server, full reprice history, photo
            audit trails, and one-click QuickBooks export — without re-keying a
            single line item.
          </p>
        </div>
      </div>
    </div>
  );
}
