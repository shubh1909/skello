import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRightIcon,
  BellIcon,
  BoltIcon,
  CheckIcon,
  LayoutDashboardIcon,
  MessageCircleIcon,
  PhoneIcon,
  ShieldIcon,
  SparklesIcon,
  UsersIcon,
} from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentUser } from "@/actions/auth";

export default async function LandingPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <LogoStrip />
        <FeatureGrid />
        <DashboardPreview />
        <CallToAction />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Logo />
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <Link href="#features" className="transition-colors hover:text-foreground">
            Features
          </Link>
          <Link href="#preview" className="transition-colors hover:text-foreground">
            Product
          </Link>
          <Link href="#cta" className="transition-colors hover:text-foreground">
            Pricing
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" render={<Link href="/login" />}>
            Log in
          </Button>
          <Button size="sm" render={<Link href="/signup" />}>
            Get started
            <ArrowRightIcon />
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(0,0,0,0.06),transparent_60%)] dark:bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.05),transparent_60%)]"
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-24 text-center md:py-32">
        <Badge variant="outline" className="rounded-full border-border/80 bg-background/80 px-3 py-1">
          <SparklesIcon className="size-3" />
          Built for ambitious B2B teams
        </Badge>
        <h1 className="font-heading text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
          The CRM your revenue team
          <br className="hidden md:block" /> actually wants to use.
        </h1>
        <p className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
          Skello unifies inbound voice, lead routing, and follow-ups in one
          minimalist workspace — so your team spends less time in tabs and more
          time closing.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Button size="lg" render={<Link href="/signup" />}>
            Start free
            <ArrowRightIcon />
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/login" />}>
            Sign in to your workspace
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-3.5" /> No credit card
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-3.5" /> 14-day trial
          </span>
          <span className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-3.5" /> SOC2-aligned
          </span>
        </div>
      </div>
    </section>
  );
}

function LogoStrip() {
  const tenants = ["Atlas", "Northwind", "Vertex", "Lumen", "Helix", "Kepler"];
  return (
    <section className="border-b border-border/60 bg-muted/30 py-10">
      <div className="mx-auto w-full max-w-6xl px-6">
        <p className="mb-6 text-center text-xs uppercase tracking-widest text-muted-foreground">
          Trusted by modern revenue teams
        </p>
        <div className="grid grid-cols-3 items-center gap-6 opacity-70 md:grid-cols-6">
          {tenants.map((t) => (
            <div
              key={t}
              className="text-center font-heading text-sm font-medium tracking-wide text-muted-foreground"
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const features = [
    {
      icon: PhoneIcon,
      title: "Voice-driven lead capture",
      desc: "Bolna.ai routes inbound calls into Skello with transcripts and intent already classified.",
    },
    {
      icon: MessageCircleIcon,
      title: "1-click WhatsApp outreach",
      desc: "Open a wa.me thread with a personalised message — without leaving the lead row.",
    },
    {
      icon: BellIcon,
      title: "Reminders that actually fire",
      desc: "Schedule follow-ups, get notified at the top of the hour, mark done in one click.",
    },
    {
      icon: ShieldIcon,
      title: "Multi-tenant by design",
      desc: "Row-level security and org-scoped queries on every read — no cross-tenant leakage.",
    },
    {
      icon: BoltIcon,
      title: "Server-rendered speed",
      desc: "React Server Components and edge-ready queries keep your dashboards instant.",
    },
    {
      icon: UsersIcon,
      title: "Built for revenue teams",
      desc: "AE, SDR, and ops views share one source of truth — not three CSVs in a Slack DM.",
    },
  ];

  return (
    <section id="features" className="border-b border-border/60 py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="mb-12 max-w-2xl space-y-3">
          <Badge variant="secondary">Why Skello</Badge>
          <h2 className="font-heading text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            Everything your team needs.
            <br />
            Nothing it doesn’t.
          </h2>
          <p className="leading-relaxed text-muted-foreground">
            A focused toolkit for capturing, qualifying, and converting B2B
            leads — without the bloat of legacy CRMs.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl bg-border md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="group relative flex flex-col gap-2 bg-background p-6 transition-colors hover:bg-muted/40"
            >
              <span className="mb-1 grid size-9 place-items-center rounded-lg bg-muted text-foreground ring-1 ring-border">
                <Icon className="size-4" />
              </span>
              <h3 className="font-heading text-base font-medium leading-tight">
                {title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <section id="preview" className="border-b border-border/60 bg-muted/30 py-24">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="mb-12 flex flex-col items-start gap-3 md:items-center md:text-center">
          <Badge variant="secondary">A glimpse</Badge>
          <h2 className="font-heading text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            Designed for daily use.
          </h2>
          <p className="max-w-xl leading-relaxed text-muted-foreground">
            Tactile, minimal, fast. The dashboard you’ll actually open before
            your inbox.
          </p>
        </div>
        <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-border/80 bg-background shadow-xl ring-1 ring-foreground/5">
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            </div>
            <span className="text-xs text-muted-foreground">
              skello.app/dashboard
            </span>
            <span />
          </div>
          <div className="grid grid-cols-12">
            <aside className="col-span-3 border-r border-border/60 p-4">
              <Logo href="" />
              <nav className="mt-6 space-y-1 text-sm">
                {[
                  { icon: LayoutDashboardIcon, label: "Dashboard", active: true },
                  { icon: UsersIcon, label: "Leads" },
                  { icon: BellIcon, label: "Reminders" },
                ].map(({ icon: Icon, label, active }) => (
                  <div
                    key={label}
                    className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 ${
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    <Icon className="size-4" />
                    {label}
                  </div>
                ))}
              </nav>
            </aside>
            <div className="col-span-9 p-6">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: "New leads", value: "128", delta: "+12%" },
                  { label: "Hot pipeline", value: "34", delta: "+4" },
                  { label: "Reminders today", value: "9", delta: "3 due" },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-lg border border-border/70 bg-card p-4"
                  >
                    <div className="text-xs text-muted-foreground">{s.label}</div>
                    <div className="mt-1 font-heading text-2xl font-semibold">
                      {s.value}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.delta}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 rounded-lg border border-border/70 bg-card">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-sm font-medium">
                  Recent leads
                  <span className="text-xs text-muted-foreground">last 24h</span>
                </div>
                <ul className="divide-y divide-border/60 text-sm">
                  {[
                    { name: "Aarav Mehta", intent: "Hot", product: "Pro plan" },
                    { name: "Lina Park", intent: "Warm", product: "Starter" },
                    { name: "Diego Alvarez", intent: "Cold", product: "Enterprise" },
                  ].map((l) => (
                    <li key={l.name} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium">
                          {l.name
                            .split(" ")
                            .map((p) => p[0])
                            .join("")}
                        </span>
                        <div>
                          <div className="font-medium">{l.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.product}
                          </div>
                        </div>
                      </div>
                      <Badge
                        variant={
                          l.intent === "Hot"
                            ? "destructive"
                            : l.intent === "Warm"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {l.intent}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CallToAction() {
  return (
    <section id="cta" className="py-24">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border/80 bg-card px-8 py-12 text-center ring-1 ring-foreground/5">
        <h2 className="font-heading text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
          Ready to upgrade your pipeline?
        </h2>
        <p className="mx-auto mt-3 max-w-md leading-relaxed text-muted-foreground">
          Spin up a workspace in under a minute. Invite your team when you’re
          ready.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button size="lg" render={<Link href="/signup" />}>
            Create your workspace
            <ArrowRightIcon />
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/login" />}>
            I already have an account
          </Button>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row">
        <Logo href="" />
        <span>© {new Date().getFullYear()} Skello. All rights reserved.</span>
        <div className="flex gap-4">
          <Link href="#" className="hover:text-foreground">Privacy</Link>
          <Link href="#" className="hover:text-foreground">Terms</Link>
          <Link href="#" className="hover:text-foreground">Status</Link>
        </div>
      </div>
    </footer>
  );
}
