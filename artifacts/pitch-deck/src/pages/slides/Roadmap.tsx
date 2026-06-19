const base = import.meta.env.BASE_URL;

export default function Roadmap() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-b from-bg to-[hsl(210_40%_95%)]" />
      <div className="absolute -left-[8vw] bottom-[5vh] h-[35vw] w-[35vw] rounded-full bg-primary/5 blur-3xl" />

      <div
        className="absolute right-[2vw] bottom-[2vh] w-[26vw] h-[26vw] pointer-events-none select-none"
        style={{ opacity: 0.07 }}
      >
        <img src={`${base}logo-drop.png`} alt="" className="h-full w-full object-contain" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col px-[7vw] py-[7vh]">
        <div className="flex items-end justify-between">
          <div>
            <div className="inline-flex items-center gap-[1vw]">
              <span className="rounded-full border border-accent/40 bg-accent/10 px-[1.2vw] py-[0.5vh] text-[1.2vw] font-extrabold uppercase tracking-[0.2em] text-accent">
                Coming Soon · In Development
              </span>
            </div>
            <h2 className="mt-[1.8vh] text-[4.4vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
              Expanding the IrrigoPro operating system.
            </h2>
          </div>
          <p className="hidden lg:block max-w-[26vw] text-[1.55vw] font-normal text-muted text-pretty">
            New tools are being developed to give irrigation companies greater
            control over inventory, controller settings, and customer
            communication.
          </p>
        </div>

        <div className="mt-[6vh] grid flex-1 grid-cols-3 gap-[2.2vw]">
          <div className="flex flex-col rounded-[1.2vw] border border-dashed border-primary/30 bg-surface p-[2.4vw] shadow-sm">
            <div className="inline-flex h-[2.8vw] w-[2.8vw] items-center justify-center rounded-[0.7vw] bg-primary/10 text-[1.3vw] font-extrabold text-primary">
              01
            </div>
            <div className="mt-[2vh] text-[2vw] font-extrabold leading-tight text-text">
              Inventory Management
            </div>
            <div className="mt-[1.4vh] text-[1.5vw] leading-snug text-muted">
              Track parts and materials across the shop, trucks, and completed
              jobs — improving accountability, availability, and purchasing
              visibility.
            </div>
          </div>

          <div className="flex flex-col rounded-[1.2vw] border border-dashed border-primary/30 bg-surface p-[2.4vw] shadow-sm">
            <div className="inline-flex h-[2.8vw] w-[2.8vw] items-center justify-center rounded-[0.7vw] bg-primary/10 text-[1.3vw] font-extrabold text-primary">
              02
            </div>
            <div className="mt-[2vh] text-[2vw] font-extrabold leading-tight text-text">
              Controller Settings &amp; Runtime Storage
            </div>
            <div className="mt-[1.4vh] text-[1.5vw] leading-snug text-muted">
              Store controller programs, watering days, start times, seasonal
              adjustments, and zone runtimes for each property.
            </div>
          </div>

          <div className="flex flex-col rounded-[1.2vw] border border-dashed border-primary/30 bg-surface p-[2.4vw] shadow-sm">
            <div className="inline-flex h-[2.8vw] w-[2.8vw] items-center justify-center rounded-[0.7vw] bg-primary/10 text-[1.3vw] font-extrabold text-primary">
              03
            </div>
            <div className="mt-[2vh] text-[2vw] font-extrabold leading-tight text-text">
              Customer-Ready Runtime Reporting
            </div>
            <div className="mt-[1.4vh] text-[1.5vw] leading-snug text-muted">
              Generate clear, professional reports that show when each
              controller and zone is scheduled to run — making it easy to
              answer common customer questions such as, &ldquo;What time does
              my zone water?&rdquo;
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
