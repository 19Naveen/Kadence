import { Link } from "react-router-dom";

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-16 overflow-hidden">
      {/* Background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 100% 70% at 50% -10%, rgba(99,102,241,0.18) 0%, transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Floating glow orbs */}
      <div className="pointer-events-none absolute top-1/3 left-1/4 size-96 rounded-full bg-primary/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-1/4 right-1/4 size-64 rounded-full bg-accent/5 blur-3xl" />

      <div className="relative z-10 max-w-4xl mx-auto text-center space-y-8">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-xs font-bold text-primary uppercase tracking-widest animate-in fade-in duration-700">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" />
          AI-Powered Lakehouse Platform
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
          Transform Raw Data
          <br />
          <span className="text-primary">Into Intelligence</span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl text-text-secondary max-w-2xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
          Kadence unifies data ingestion, schema management, visual analytics, and ML training
          into one collaborative platform — from raw files to production predictions.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
          <Link
            to="/signup"
            className="btn btn-primary px-8 py-3 text-base font-bold shadow-2xl shadow-primary/20 hover:scale-[1.03] active:scale-[0.98] transition-transform"
          >
            Get Started Free
          </Link>
          <a
            href="#features"
            className="btn btn-secondary px-8 py-3 text-base font-semibold"
          >
            Explore Features →
          </a>
        </div>

        {/* Mock UI preview */}
        <div className="mt-12 animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-500 max-w-3xl mx-auto">
          <div className="card p-1.5 shadow-2xl shadow-black/30 border border-border">
            {/* Fake window bar */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border-subtle">
              <div className="size-2.5 rounded-full bg-danger/60" />
              <div className="size-2.5 rounded-full bg-warning/60" />
              <div className="size-2.5 rounded-full bg-success/60" />
              <div className="ml-4 flex-1 h-4 rounded-full bg-surface-2 max-w-xs" />
            </div>
            {/* Fake stats grid */}
            <div className="p-4 grid grid-cols-4 gap-3">
              {[
                { label: "Datasets", value: "1,284", color: "text-primary" },
                { label: "Pipelines", value: "47", color: "text-success" },
                { label: "Models", value: "12", color: "text-accent" },
                { label: "Accuracy", value: "94.8%", color: "text-warning" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-surface-2/60 border border-border-subtle p-3 text-center">
                  <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                  <p className="text-[10px] text-text-tertiary font-bold uppercase tracking-widest mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            {/* Fake chart bars */}
            <div className="px-4 pb-4 flex items-end gap-1.5 h-20">
              {[60, 40, 75, 55, 90, 45, 80, 65, 95, 50, 70, 85].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-sm bg-primary/30"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
