import {
  ArrowRight,
  ClipboardList,
  Wrench,
  Droplets,
  ReceiptText,
  CheckCircle2,
  Smartphone,
  ShieldCheck,
  Zap,
  Calendar,
  Camera,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { DemoForm } from "@/components/demo-form";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Hero />
      <TrustBar />
      <Features />
      <Workflow />
      <FieldOfficeSplit />
      <DemoSection />
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="hero-bg relative overflow-hidden">
      <div className="grid-pattern pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-24 lg:pt-28">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Droplets className="h-3.5 w-3.5" />
              Built for irrigation companies
            </span>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Run your irrigation business{" "}
              <span className="brand-text-gradient">end-to-end.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground sm:text-xl">
              IrrigoPro turns estimates into scheduled work, scheduled work
              into wet-checked jobs, and finished jobs into QuickBooks
              invoices — without spreadsheets, paper tickets, or chasing your
              crew for the details.
            </p>
            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <a href="#demo">
                <Button
                  size="lg"
                  className="brand-gradient brand-glow h-12 px-7 text-base font-semibold text-white"
                  data-testid="button-hero-demo"
                >
                  Request a demo
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </a>
              <a href="#how-it-works">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 px-6 text-base"
                  data-testid="button-hero-how"
                >
                  See how it works
                </Button>
              </a>
            </div>
            <ul className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-accent" />
                No credit card required
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-accent" />
                QuickBooks Online integration
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-accent" />
                Field-tech friendly on any phone
              </li>
            </ul>
          </div>

          <div className="lg:col-span-5">
            <HeroVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="relative">
      <div className="brand-glow absolute -inset-2 rounded-3xl bg-primary/10 blur-2xl" />
      <div className="relative rounded-3xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          <span className="ml-3 text-xs font-medium text-muted-foreground">
            irrigopro.com / today
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label="Open work orders" value="14" tone="primary" />
          <Stat label="Wet checks today" value="6" tone="accent" />
          <Stat label="Ready to invoice" value="$8,420" tone="primary" />
        </div>

        <div className="mt-5 space-y-3">
          <TicketRow
            customer="Ridgeview HOA"
            location="Controller B · Zone 4"
            status="Scheduled"
            tone="primary"
          />
          <TicketRow
            customer="Oakmont Office Park"
            location="Mainline repair"
            status="In progress"
            tone="accent"
          />
          <TicketRow
            customer="Cypress Townhomes"
            location="Wet check · 12 zones"
            status="Ready to bill"
            tone="emerald"
          />
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl bg-secondary px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ReceiptText className="h-4 w-4 text-primary" />
            Send to QuickBooks
          </div>
          <Button size="sm" className="brand-gradient text-white">
            Invoice 7 jobs
          </Button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "primary" | "accent";
}) {
  const ring = tone === "primary" ? "border-primary/20 bg-primary/5" : "border-accent/20 bg-accent/5";
  const text = tone === "primary" ? "text-primary" : "text-accent";
  return (
    <div className={`rounded-xl border ${ring} p-3`}>
      <div className={`text-xl font-bold ${text}`}>{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function TicketRow({
  customer,
  location,
  status,
  tone,
}: {
  customer: string;
  location: string;
  status: string;
  tone: "primary" | "accent" | "emerald";
}) {
  const map = {
    primary: "bg-primary/10 text-primary",
    accent: "bg-accent/10 text-accent",
    emerald: "bg-emerald-100 text-emerald-700",
  } as const;
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-foreground">{customer}</div>
        <div className="text-xs text-muted-foreground">{location}</div>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${map[tone]}`}>
        {status}
      </span>
    </div>
  );
}

function TrustBar() {
  return (
    <section className="border-y border-border/60 bg-background">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-8 sm:grid-cols-4 sm:px-6 lg:px-8">
        {[
          { label: "Estimates → invoices", value: "1 app" },
          { label: "Field photos / job", value: "Unlimited" },
          { label: "QuickBooks sync", value: "1-click" },
          { label: "Works offline", value: "Yes" },
        ].map((item) => (
          <div key={item.label} className="text-center sm:text-left">
            <div className="text-2xl font-bold text-foreground">{item.value}</div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {item.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: ClipboardList,
    title: "Estimates that close faster",
    body: "Build estimates from your parts catalog and customer labor rates, send for review, and let customers approve from a phone.",
    bullets: ["Draft → review → approved lifecycle", "Customer-specific labor rates", "PDF + email built in"],
  },
  {
    icon: Wrench,
    title: "Work orders your crew actually uses",
    body: "Schedule technicians, attach the customer's site map, and capture parts, labor, and photos at the controller — even offline.",
    bullets: ["Per-zone notes & photo capture", "Technician scheduling", "Offline-safe field app"],
  },
  {
    icon: Droplets,
    title: "Wet checks, by the zone",
    body: "Standardized inspections per controller and zone with finding immutability and auto-billing — auditable from the office.",
    bullets: ["Zone-by-zone findings", "Immutable inspection log", "Auto-create billing items"],
  },
  {
    icon: FileSpreadsheet,
    title: "Billing sheets, not spreadsheets",
    body: "Completed work flows into a billing sheet with authoritative pricing, markup, and tax. Reprice with full audit history.",
    bullets: ["Server-authoritative pricing", "Reprice history", "Photos attached to every line"],
  },
  {
    icon: ReceiptText,
    title: "QuickBooks invoicing in one click",
    body: "Push approved billing sheets straight to QuickBooks Online as polished invoices — without re-entering line items.",
    bullets: ["QuickBooks Online OAuth", "Customer auto-mapping", "PDFs delivered to inbox"],
  },
  {
    icon: ShieldCheck,
    title: "Roles for every seat",
    body: "Field techs see what they need, billing managers own pricing, company admins own everything. Audit trails on every status change.",
    bullets: ["Field tech / manager / billing roles", "Status transition audit", "Per-company isolation"],
  },
];

function Features() {
  return (
    <section id="features" className="relative">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
            One app, the whole job
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything an irrigation company runs on.
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            IrrigoPro replaces the patchwork of spreadsheets, text threads, and
            paper tickets your crew uses today.
          </p>
        </div>

        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
              data-testid={`feature-${f.title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-bold text-foreground">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {f.body}
              </p>
              <ul className="mt-4 space-y-2">
                {f.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2 text-sm text-foreground">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-accent" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    icon: ClipboardList,
    title: "Estimate",
    body: "Build it from your parts catalog and customer labor rates. Send for review. Capture customer approval.",
  },
  {
    icon: Wrench,
    title: "Schedule & dispatch",
    body: "Convert approved estimates into work orders, assign technicians, and share the site map and zone history.",
  },
  {
    icon: Camera,
    title: "Field & wet check",
    body: "Crew captures parts used, labor, and zone-by-zone wet check findings — with photos, even offline.",
  },
  {
    icon: ReceiptText,
    title: "Bill & invoice",
    body: "Completed jobs flow into a billing sheet, then push straight to QuickBooks Online as a polished invoice.",
  },
];

function Workflow() {
  return (
    <section id="how-it-works" className="bg-secondary/40">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            How it works
          </span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Estimate. Schedule. Service. Invoice.
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            One thread that ties the office to the field — and the field back to your accountant.
          </p>
        </div>

        <ol className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="relative rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="absolute -top-3 left-6 rounded-full brand-gradient px-2.5 py-0.5 text-xs font-bold text-white">
                Step {i + 1}
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-bold text-foreground">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FieldOfficeSplit() {
  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid gap-10 lg:grid-cols-2">
          <SplitCard
            tone="primary"
            eyebrow="Field"
            icon={Smartphone}
            title="Built for the truck, not the desk."
            body="Your crew gets a fast, mobile-first app with the customer's site map, controller history, and the right form for the job — no pricing exposed to field techs."
            bullets={[
              { icon: Camera, text: "Capture photos at every controller and zone" },
              { icon: ShieldCheck, text: "Pricing hidden from field-tech roles" },
              { icon: Zap, text: "Works offline; syncs the moment you reconnect" },
            ]}
          />
          <SplitCard
            tone="accent"
            eyebrow="Office"
            icon={FileSpreadsheet}
            title="Billing managers in control."
            body="Authoritative pricing on the server, full reprice history, photo audit trails, and one-click QuickBooks export."
            bullets={[
              { icon: ReceiptText, text: "Push approved billing sheets to QuickBooks Online" },
              { icon: Calendar, text: "Status-transition audit on every ticket" },
              { icon: ClipboardList, text: "Per-company isolation and role-based access" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

function SplitCard({
  tone,
  eyebrow,
  icon: Icon,
  title,
  body,
  bullets,
}: {
  tone: "primary" | "accent";
  eyebrow: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  bullets: { icon: React.ComponentType<{ className?: string }>; text: string }[];
}) {
  const accent = tone === "primary" ? "text-primary bg-primary/10" : "text-accent bg-accent/10";
  return (
    <div className="rounded-3xl border border-border bg-card p-8 shadow-sm">
      <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${accent}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className={`mt-4 inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider ${accent}`}>
        {eyebrow}
      </div>
      <h3 className="mt-3 text-2xl font-bold tracking-tight text-foreground">{title}</h3>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">{body}</p>
      <ul className="mt-6 space-y-3">
        {bullets.map((b) => (
          <li key={b.text} className="flex items-start gap-3 text-sm text-foreground">
            <span className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg ${accent}`}>
              <b.icon className="h-4 w-4" />
            </span>
            <span className="pt-1">{b.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DemoSection() {
  return (
    <section id="demo" className="hero-bg relative overflow-hidden">
      <div className="grid-pattern pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
        <div className="grid items-start gap-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              Request a demo
            </span>
            <h2 className="mt-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              See IrrigoPro on your jobs.
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Tell us a little about your company and a member of the IrrigoPro
              team will set up a 30-minute walkthrough — no slides, just the
              app on real irrigation work like yours.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-accent" />
                <span>30-minute live walkthrough on your data, not a canned demo.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-accent" />
                <span>Includes onboarding plan tailored to your crew size.</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-accent" />
                <span>QuickBooks Online integration walkthrough included.</span>
              </li>
            </ul>
          </div>

          <div className="lg:col-span-7">
            <DemoForm />
          </div>
        </div>
      </div>
    </section>
  );
}
