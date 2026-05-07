import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { DemoForm } from "@/components/demo-form";

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <section className="hero-bg relative overflow-hidden">
        <div className="grid-pattern pointer-events-none absolute inset-0 opacity-40" />
        <div className="relative mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="text-center">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              Request an IrrigoPro demo
            </h1>
            <p className="mt-3 text-lg text-muted-foreground">
              Tell us about your irrigation company and we'll schedule a
              30-minute walkthrough on your real workflow.
            </p>
          </div>
          <div className="mt-10">
            <DemoForm />
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
