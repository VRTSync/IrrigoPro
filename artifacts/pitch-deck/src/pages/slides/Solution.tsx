export default function Solution() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(210_67%_36%)] via-[hsl(212_77%_24%)] to-[hsl(212_77%_14%)]" />
      <div className="absolute -left-[15vw] top-[20vh] h-[45vw] w-[45vw] rounded-full bg-accent/15 blur-3xl" />

      <div className="relative z-10 flex h-full w-full flex-col justify-center px-[10vw]">
        <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-accent">
          03 · The Solution
        </div>
        <h2 className="mt-[2.5vh] max-w-[78vw] text-[6vw] font-extrabold leading-[0.98] tracking-tight text-white text-balance">
          One app that connects the entire irrigation operation.
        </h2>
        <p className="mt-[3.5vh] max-w-[68vw] text-[2.2vw] font-normal leading-snug text-white/85 text-pretty">
          IrrigoPro connects estimates, work orders, wet checks, billing sheets,
          and QuickBooks/Aspire invoicing — without spreadsheets, paper tickets,
          or chasing crews for missing details.
        </p>

        <div className="mt-[6vh] grid grid-cols-3 gap-[2.4vw] max-w-[68vw]">
          <div>
            <div className="text-[3vw] font-extrabold text-accent leading-none">1 platform</div>
            <div className="mt-[1vh] text-[1.5vw] font-semibold text-white/80">
              Four connected workflows
            </div>
          </div>
          <div>
            <div className="text-[3vw] font-extrabold text-accent leading-none">1-click</div>
            <div className="mt-[1vh] text-[1.5vw] font-semibold text-white/80">
              QuickBooks/Aspire sync
            </div>
          </div>
          <div>
            <div className="text-[3vw] font-extrabold text-accent leading-none">Offline</div>
            <div className="mt-[1vh] text-[1.5vw] font-semibold text-white/80">
              Built for the field
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
