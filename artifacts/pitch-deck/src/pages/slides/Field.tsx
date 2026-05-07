export default function Field() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-[hsl(210_40%_94%)]" />

      <div className="relative z-10 grid h-full w-full grid-cols-12 gap-[3vw] px-[7vw] py-[8vh]">
        <div className="col-span-6 flex flex-col justify-center">
          <div className="inline-flex items-center gap-[0.8vw]">
            <span className="rounded-full bg-primary/10 px-[1vw] py-[0.5vh] text-[1.2vw] font-extrabold uppercase tracking-[0.25em] text-primary">
              Field
            </span>
            <span className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-muted">
              05
            </span>
          </div>
          <h2 className="mt-[2.5vh] text-[4.6vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
            Built for the truck, not the desk.
          </h2>
          <p className="mt-[3vh] max-w-[40vw] text-[1.9vw] font-normal leading-snug text-muted text-pretty">
            Your crew gets a fast, mobile-first app with the customer&apos;s
            site map, controller history, and the right form for the job — no
            pricing exposed to field techs.
          </p>
        </div>

        <div className="col-span-6 flex flex-col justify-center gap-[2vh]">
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[2vw] shadow-sm">
            <span className="mt-[0.4vh] inline-flex h-[3vw] w-[3vw] flex-none items-center justify-center rounded-[0.7vw] bg-accent/15 text-[1.6vw] font-extrabold text-accent">
              01
            </span>
            <div>
              <div className="text-[1.9vw] font-extrabold text-text">
                Photo capture at every controller
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                Per-zone notes and photos attach to the work order automatically.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[2vw] shadow-sm">
            <span className="mt-[0.4vh] inline-flex h-[3vw] w-[3vw] flex-none items-center justify-center rounded-[0.7vw] bg-accent/15 text-[1.6vw] font-extrabold text-accent">
              02
            </span>
            <div>
              <div className="text-[1.9vw] font-extrabold text-text">
                Pricing hidden from field roles
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                Techs see what they need. Margin stays in the office.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[2vw] shadow-sm">
            <span className="mt-[0.4vh] inline-flex h-[3vw] w-[3vw] flex-none items-center justify-center rounded-[0.7vw] bg-accent/15 text-[1.6vw] font-extrabold text-accent">
              03
            </span>
            <div>
              <div className="text-[1.9vw] font-extrabold text-text">
                Works offline, syncs on reconnect
              </div>
              <div className="mt-[0.6vh] text-[1.55vw] text-muted">
                Cell dead zones don&apos;t stop the job — or the paperwork.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
