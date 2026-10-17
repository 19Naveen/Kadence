import { Link } from "react-router-dom";
import { Filter, Merge, Sigma, Upload, type LucideIcon } from "lucide-react";

/** Decorative illustration of a pipeline; no real data is implied. */
const pipelineSteps: { Icon: LucideIcon; label: string }[] = [
  { Icon: Upload, label: "Import" },
  { Icon: Filter, label: "Filter" },
  { Icon: Merge, label: "Join" },
  { Icon: Sigma, label: "Summarise" },
];

export function HeroSection() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-16 pt-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 100% 70% at 50% -10%, hsl(var(--primary) / 0.14) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--text)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--text)) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <div className="relative z-10 mx-auto max-w-4xl animate-slide-up space-y-8 text-center">
        <p className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary-muted px-4 py-1.5 text-xs font-semibold text-primary">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          Data workspace for teams
        </p>

        <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
          Shape your data.
          <br />
          <span className="text-primary">Ask it questions.</span>
        </h1>

        <p className="mx-auto max-w-2xl text-lg leading-relaxed text-text-secondary sm:text-xl">
          Bring in files and databases, shape them step by step in Pipeline Studio, keep every import versioned, then
          query with SQL and chart the results.
        </p>

        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link to="/signup" className="btn btn-primary h-11 px-8 text-base">Create account</Link>
          <a href="#how-it-works" className="btn btn-secondary h-11 px-8 text-base">See how it works</a>
        </div>

        <div aria-hidden="true" className="mx-auto mt-12 max-w-3xl">
          <div className="card border-border p-1.5 shadow-soft-lg">
            <div className="flex items-center gap-1.5 border-b border-border-subtle px-3 py-2">
              <div className="size-2.5 rounded-full bg-surface-3" />
              <div className="size-2.5 rounded-full bg-surface-3" />
              <div className="size-2.5 rounded-full bg-surface-3" />
              <div className="ml-4 h-4 max-w-xs flex-1 rounded-full bg-surface-2" />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 p-4 sm:gap-3">
              {pipelineSteps.map(({ Icon, label }, i) => (
                <div key={label} className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-text">
                    <Icon size={15} className="text-primary" />
                    {label}
                  </div>
                  {i < pipelineSteps.length - 1 && <div className="h-px w-4 bg-border sm:w-8" />}
                </div>
              ))}
            </div>

            <div className="space-y-2 px-4 pb-4">
              {[1, 2, 3, 4].map((row) => (
                <div key={row} className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((col) => (
                    <div key={col} className={`h-3 rounded-xs ${row === 1 ? "bg-primary/25" : "bg-surface-2"}`} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
