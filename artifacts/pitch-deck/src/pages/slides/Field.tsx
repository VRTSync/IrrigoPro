export default function Field() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg font-body text-text">
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-bg to-[hsl(210_40%_94%)]" />

      <div className="relative z-10 grid h-full w-full grid-cols-12 gap-[3vw] px-[7vw] py-[6vh]">
        <div className="col-span-6 flex flex-col justify-center">
          <div className="inline-flex items-center gap-[0.8vw]">
            <span className="rounded-full bg-primary/10 px-[1vw] py-[0.5vh] text-[1.2vw] font-extrabold uppercase tracking-[0.25em] text-primary">
              Field-first
            </span>
            <span className="text-[1.4vw] font-semibold uppercase tracking-[0.3em] text-muted">
              05
            </span>
          </div>
          <h2 className="mt-[2vh] text-[4vw] font-extrabold leading-[1.0] tracking-tight text-text text-balance">
            Built for the truck and the field — not just the desk.
          </h2>
          <p className="mt-[2vh] max-w-[40vw] text-[1.75vw] font-normal leading-snug text-muted text-pretty">
            Software only works when people actually use it. IrrigoPro is
            intuitive enough for a tech to pick up on day one — clean, fast,
            and designed around the job, not around the software.
          </p>
          <p className="mt-[1.4vh] max-w-[40vw] text-[1.55vw] font-normal leading-snug text-muted/75 text-pretty">
            Great irrigation businesses are built from the ground up. Get
            adoption from the crew first — then the office follows.
          </p>
        </div>

        <div className="col-span-6 flex flex-col justify-center gap-[1.6vh]">
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[1.6vw] shadow-sm">
            <span className="mt-[0.3vh] inline-flex h-[2.8vw] w-[2.8vw] flex-none items-center justify-center rounded-[0.6vw] bg-accent/15 text-[1.4vw] font-extrabold text-accent">
              01
            </span>
            <div>
              <div className="text-[1.75vw] font-extrabold text-text">
                Intuitive from the first job
              </div>
              <div className="mt-[0.5vh] text-[1.45vw] text-muted">
                Techs open the app, see their assigned jobs, and know exactly
                what to do. The interface is built around how the work already
                flows — not the other way around.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[1.6vw] shadow-sm">
            <span className="mt-[0.3vh] inline-flex h-[2.8vw] w-[2.8vw] flex-none items-center justify-center rounded-[0.6vw] bg-accent/15 text-[1.4vw] font-extrabold text-accent">
              02
            </span>
            <div>
              <div className="text-[1.75vw] font-extrabold text-text">
                Capture everything, right where the work happens
              </div>
              <div className="mt-[0.5vh] text-[1.45vw] text-muted">
                Photos, findings, parts, and notes attach to the specific
                controller, zone, or job — not lost in a camera roll or a text
                thread.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-[1.4vw] rounded-[1vw] border border-border bg-surface p-[1.6vw] shadow-sm">
            <span className="mt-[0.3vh] inline-flex h-[2.8vw] w-[2.8vw] flex-none items-center justify-center rounded-[0.6vw] bg-accent/15 text-[1.4vw] font-extrabold text-accent">
              03
            </span>
            <div>
              <div className="text-[1.75vw] font-extrabold text-text">
                Works offline, syncs on reconnect
              </div>
              <div className="mt-[0.5vh] text-[1.45vw] text-muted">
                Dead zones and basement mechanical rooms do not stop the job.
                Everything queues and syncs the moment coverage returns.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
