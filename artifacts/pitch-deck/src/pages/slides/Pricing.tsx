export default function Pricing() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(210_67%_36%)] via-[hsl(212_77%_24%)] to-[hsl(212_77%_14%)]" />
      <div className="absolute -right-[10vw] top-[10vh] h-[40vw] w-[40vw] rounded-full bg-accent/10 blur-3xl" />

      <div className="relative z-10 flex h-full w-full flex-col justify-center px-[10vw]">
        <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-accent">
          10 · Get started
        </div>
        <h2 className="mt-[2.5vh] max-w-[70vw] text-[5.6vw] font-extrabold leading-[1.0] tracking-tight text-white text-balance">
          See IrrigoPro on your jobs.
        </h2>
        <p className="mt-[3vh] max-w-[60vw] text-[2vw] font-normal leading-snug text-white/85 text-pretty">
          A 30-minute live walkthrough on real irrigation work like yours — no
          canned demo, no credit card, no slides.
        </p>

        <div className="mt-[5vh] grid grid-cols-3 gap-[2vw] max-w-[70vw]">
          <div className="rounded-[1vw] border border-white/15 bg-white/5 p-[1.8vw]">
            <div className="text-[1.3vw] font-extrabold uppercase tracking-[0.2em] text-accent">
              30 minutes
            </div>
            <div className="mt-[1.2vh] text-[1.7vw] font-extrabold text-white">
              Live walkthrough
            </div>
            <div className="mt-[0.8vh] text-[1.4vw] text-white/70">
              On your data, not a canned demo.
            </div>
          </div>
          <div className="rounded-[1vw] border border-white/15 bg-white/5 p-[1.8vw]">
            <div className="text-[1.3vw] font-extrabold uppercase tracking-[0.2em] text-accent">
              No card
            </div>
            <div className="mt-[1.2vh] text-[1.7vw] font-extrabold text-white">
              Try before you buy
            </div>
            <div className="mt-[0.8vh] text-[1.4vw] text-white/70">
              Onboarding plan tailored to your crew size.
            </div>
          </div>
          <div className="rounded-[1vw] border border-white/15 bg-white/5 p-[1.8vw]">
            <div className="text-[1.3vw] font-extrabold uppercase tracking-[0.2em] text-accent">
              QuickBooks
            </div>
            <div className="mt-[1.2vh] text-[1.7vw] font-extrabold text-white">
              Integration walkthrough
            </div>
            <div className="mt-[0.8vh] text-[1.4vw] text-white/70">
              Connected to QuickBooks Online during the demo.
            </div>
          </div>
        </div>

        <div className="mt-[6vh] inline-flex items-center gap-[1.4vw] rounded-full bg-accent px-[2.4vw] py-[1.6vh] text-[1.8vw] font-extrabold text-white w-fit">
          Request a demo at irrigopro.com
          <span className="text-[2vw]">→</span>
        </div>
      </div>
    </div>
  );
}
