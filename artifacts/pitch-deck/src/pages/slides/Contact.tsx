const base = import.meta.env.BASE_URL;

export default function Contact() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <img
        src={`${base}closing-aerial.png`}
        crossOrigin="anonymous"
        alt="Aerial view of a commercial property with irrigated landscaping"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(212_77%_14%/0.92)] via-[hsl(212_77%_14%/0.7)] to-[hsl(212_77%_14%/0.55)]" />

      <div
        className="absolute right-[-6vw] bottom-[-4vh] w-[48vw] h-[48vw] pointer-events-none select-none"
        style={{ opacity: 0.12 }}
      >
        <img src={`${base}logo-geometric.png`} alt="" className="h-full w-full object-contain" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-[4vh] px-[7vw] py-[7vh]">
        <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-accent">
          12 · Next step
        </div>

        <h2 className="text-center text-[6vw] font-extrabold leading-[0.98] tracking-tight text-white text-balance max-w-[75vw]">
          Let&apos;s put IrrigoPro to work.
        </h2>

        <p className="text-center max-w-[55vw] text-[2vw] font-normal leading-snug text-white/85 text-pretty">
          Start with one property, walk through each ticket type with your
          team, and build a clear path toward full implementation and future
          Aspire integration.
        </p>

        <div className="mt-[2vh] flex flex-col items-center gap-[1.6vh]">
          <img
            src={`${base}logo-horizontal.png`}
            alt="IrrigoPro"
            className="h-[8vh] w-auto"
            style={{ filter: "brightness(0) invert(1)" }}
          />
          <div className="text-[1.8vw] font-semibold text-white/70 tracking-wide">
            irrigopro.com
          </div>
        </div>
      </div>
    </div>
  );
}
