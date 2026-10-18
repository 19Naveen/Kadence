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
    <section className="px-6 pb-20 pt-20 sm:pt-28">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl sm:leading-[1.1]">
            Shape your data.
            <br />
            <span className="text-text-secondary">Ask it questions.</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-text-secondary sm:text-lg">
            A data workspace for teams. Bring in files and databases, shape them step by step in Pipeline Studio, keep
            every import versioned, then query with SQL and chart the results.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/signup" className="btn btn-primary h-9 px-4">Create account</Link>
            <a href="#how-it-works" className="btn btn-secondary h-9 px-4">See how it works</a>
          </div>
        </div>

        <div aria-hidden="true" className="mt-16 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            {pipelineSteps.map(({ Icon, label }, i) => (
              <div key={label} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-[13px] text-text">
                  <Icon size={14} className="text-text-tertiary" />
                  {label}
                </div>
                {i < pipelineSteps.length - 1 && <div className="h-px w-4 bg-border sm:w-6" />}
              </div>
            ))}
          </div>
          <div className="divide-y divide-border-subtle">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="grid grid-cols-5 gap-6 px-4 py-2.5">
                {[0, 1, 2, 3, 4].map((col) => (
                  <div key={col} className={`h-2.5 rounded-xs ${row === 0 ? "w-2/3 bg-text-tertiary/30" : "bg-surface-2"}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
