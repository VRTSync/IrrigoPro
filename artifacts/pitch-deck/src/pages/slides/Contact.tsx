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

      <div className="relative z-10 flex h-full w-full flex-col justify-between px-[7vw] py-[7vh]">
        <div className="flex items-center gap-[1.2vw]">
          <span className="inline-block h-[2.4vw] w-[2.4vw] rounded-[0.6vw] bg-accent" />
          <span className="text-[1.8vw] font-extrabold uppercase tracking-[0.25em] text-white">
            IrrigoPro
          </span>
        </div>

        <div className="max-w-[70vw]">
          <div className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-accent">
            11 · Talk to us
          </div>
          <h2 className="mt-[2vh] text-[6vw] font-extrabold leading-[0.98] tracking-tight text-white text-balance">
            Estimate. Schedule. Service. Invoice.
          </h2>
          <p className="mt-[3vh] max-w-[55vw] text-[2vw] font-normal leading-snug text-white/85 text-pretty">
            One app for the whole job — built for the crews running irrigation
            today.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-[2vw] border-t border-white/20 pt-[3vh] text-white">
          <div>
            <div className="text-[1.3vw] font-semibold uppercase tracking-[0.25em] text-accent">
              Web
            </div>
            <div className="mt-[1vh] text-[1.9vw] font-extrabold">
              irrigopro.com
            </div>
          </div>
          <div>
            <div className="text-[1.3vw] font-semibold uppercase tracking-[0.25em] text-accent">
              App
            </div>
            <div className="mt-[1vh] text-[1.9vw] font-extrabold">
              app.irrigopro.com
            </div>
          </div>
          <div>
            <div className="text-[1.3vw] font-semibold uppercase tracking-[0.25em] text-accent">
              Demo
            </div>
            <div className="mt-[1vh] text-[1.9vw] font-extrabold">
              irrigopro.com/demo
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
