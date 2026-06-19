const base = import.meta.env.BASE_URL;

export default function Cover() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body">
      <img
        src={`${base}hero-field.png`}
        crossOrigin="anonymous"
        alt="Irrigation technician at a controller in the field"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-[hsl(212_77%_14%/0.85)] via-[hsl(212_77%_14%/0.55)] to-[hsl(212_77%_14%/0.15)]" />

      <div className="relative z-10 flex h-full w-full flex-col justify-between px-[7vw] py-[7vh]">
        <div className="flex items-center gap-[1.2vw]">
          <span className="inline-block h-[2.4vw] w-[2.4vw] rounded-[0.6vw] bg-accent" />
          <span className="text-[1.8vw] font-extrabold uppercase tracking-[0.25em] text-white">
            IrrigoPro
          </span>
        </div>

        <div className="max-w-[60vw]">
          <span className="inline-flex items-center gap-[0.8vw] rounded-full border border-white/30 bg-white/10 px-[1.4vw] py-[0.6vh] text-[1.4vw] font-semibold uppercase tracking-[0.2em] text-white/90">
            <span className="h-[0.8vw] w-[0.8vw] rounded-full bg-accent" />
            Built for irrigation companies
          </span>
          <h1 className="mt-[3vh] text-[6.4vw] font-extrabold leading-[0.95] tracking-tight text-white text-balance">
            Run your irrigation business end-to-end.
          </h1>
          <p className="mt-[3vh] max-w-[48vw] text-[2.1vw] font-normal leading-snug text-white/85 text-pretty">
            From the first estimate to the final invoice, IrrigoPro connects
            the office, the field, and QuickBooks/Aspire in one platform.
          </p>
        </div>

        <div className="flex items-end justify-between text-white/80">
          <div className="text-[1.5vw] font-semibold tracking-wide">
            irrigopro.com
          </div>
          <div className="text-[1.5vw] font-normal">
            Valor Landscape · 2026
          </div>
        </div>
      </div>
    </div>
  );
}
