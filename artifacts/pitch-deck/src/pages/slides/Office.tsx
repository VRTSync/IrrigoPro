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
                Office-controlled pricing
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                Labor rates, markup, tax, and pricing rules are managed in one
                place for consistent billing.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[2vw] shadow-sm">
            <span className="mt-[0.4vh] inline-flex h-[3vw] w-[3vw] flex-none items-center justify-center rounded-[0.7vw] bg-primary/10 text-[1.6vw] font-extrabold text-primary">
              02
            </span>
            <div>
              <div className="text-[1.9vw] font-extrabold text-text">
                Full revision history
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                Every change to a billing sheet is recorded with the user,
                date, and prior value.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[2vw] shadow-sm">
            <span className="mt-[0.4vh] inline-flex h-[3vw] w-[3vw] flex-none items-center justify-center rounded-[0.7vw] bg-primary/10 text-[1.6vw] font-extrabold text-primary">
              03
            </span>
            <div>
              <div className="text-[1.9vw] font-extrabold text-text">
                Supporting documentation attached
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                Photos, notes, parts, and labor remain connected to related
                billing items for faster review and easier customer communication.
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
            Billing managers stay in control.
          </h2>
          <p className="mt-[3vh] max-w-[40vw] text-[1.9vw] font-normal leading-snug text-muted text-pretty">
            Office teams can review completed work, confirm pricing, track
            revisions, and send approved billing into QuickBooks/Aspire without
            rebuilding the job from field notes.
          </p>
        </div>
      </div>
    </div>
  );
}
