export default function QuickBooks() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-[hsl(210_40%_94%)]" />
      <div className="absolute -right-[10vw] -bottom-[10vw] h-[40vw] w-[40vw] rounded-full bg-accent/10 blur-3xl" />

      <div className="relative z-10 grid h-full w-full grid-cols-12 gap-[3vw] px-[7vw] py-[8vh]">
        <div className="col-span-6 flex flex-col justify-center">
          <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-primary">
            08 · QuickBooks/Aspire integration
          </div>
          <h2 className="mt-[2.5vh] text-[4.8vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
            Push approved billing directly into QuickBooks/Aspire.
          </h2>
          <p className="mt-[3vh] max-w-[40vw] text-[1.9vw] font-normal leading-snug text-muted text-pretty">
            Once a billing sheet is reviewed and approved, IrrigoPro sends the
            completed billing details into QuickBooks/Aspire — reducing manual
            entry and keeping field documentation connected to the final
            invoice.
          </p>
        </div>

        <div className="col-span-6 flex flex-col justify-center">
          <div className="rounded-[1.2vw] border border-border bg-surface p-[2vw] shadow-md">
            <div className="flex items-center justify-between border-b border-border pb-[1.4vh]">
              <div className="flex items-center gap-[0.8vw]">
                <span className="h-[1vw] w-[1vw] rounded-full bg-[hsl(0_0%_82%)]" />
                <span className="h-[1vw] w-[1vw] rounded-full bg-[hsl(0_0%_82%)]" />
                <span className="h-[1vw] w-[1vw] rounded-full bg-[hsl(0_0%_82%)]" />
              </div>
              <div className="text-[1.2vw] font-semibold text-muted">
                Billing sheet → QuickBooks/Aspire
              </div>
            </div>

            <div className="mt-[2vh] flex items-center justify-between rounded-[0.8vw] bg-bg px-[1.4vw] py-[1.4vh]">
              <div>
                <div className="text-[1.5vw] font-extrabold text-text">
                  Cypress Townhomes
                </div>
                <div className="text-[1.3vw] text-muted">
                  Wet check · 12 zones · 4 photos
                </div>
              </div>
              <div className="text-[1.8vw] font-extrabold text-primary">
                $2,840.00
              </div>
            </div>

            <div className="mt-[1.4vh] flex items-center justify-between rounded-[0.8vw] bg-bg px-[1.4vw] py-[1.4vh]">
              <div>
                <div className="text-[1.5vw] font-extrabold text-text">
                  Oakmont Office Park
                </div>
                <div className="text-[1.3vw] text-muted">
                  Mainline repair · 2 hours
                </div>
              </div>
              <div className="text-[1.8vw] font-extrabold text-primary">
                $1,460.00
              </div>
            </div>

            <div className="mt-[1.4vh] flex items-center justify-between rounded-[0.8vw] bg-bg px-[1.4vw] py-[1.4vh]">
              <div>
                <div className="text-[1.5vw] font-extrabold text-text">
                  Ridgeview HOA
                </div>
                <div className="text-[1.3vw] text-muted">
                  Controller B · 4 zones
                </div>
              </div>
              <div className="text-[1.8vw] font-extrabold text-primary">
                $4,120.00
              </div>
            </div>

            <div className="mt-[2.4vh] flex items-center justify-between rounded-[0.8vw] bg-accent/15 px-[1.4vw] py-[1.6vh]">
              <div className="text-[1.5vw] font-extrabold text-text">
                Send approved billing
              </div>
              <div className="rounded-[0.6vw] bg-accent px-[1.2vw] py-[1vh] text-[1.4vw] font-extrabold text-white">
                Invoice 3 jobs
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
