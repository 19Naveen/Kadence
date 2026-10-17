import { Link } from "react-router-dom";

export function CtaBanner() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto">
        <div
          className="card p-12 text-center relative overflow-hidden border border-primary/20"
          style={{
            background:
              "radial-gradient(ellipse 80% 100% at 50% 0%, rgba(99,102,241,0.12), transparent)",
          }}
        >
          <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-96 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

          <p className="text-xs font-black uppercase tracking-widest text-primary mb-4">
            Start building today
          </p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-tight mb-4">
            Your data has a story.
            <br />
            <span className="text-primary">Kadence tells it.</span>
          </h2>
          <p className="text-text-secondary text-lg max-w-xl mx-auto mb-8">
            Join data teams already transforming raw datasets into actionable intelligence.
            No credit card required.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/signup"
              className="btn btn-primary px-8 py-3 text-base font-bold shadow-2xl shadow-primary/20 hover:scale-[1.03] active:scale-[0.98] transition-transform"
            >
              Create Free Account
            </Link>
            <Link
              to="/signin"
              className="btn btn-secondary px-8 py-3 text-base font-semibold"
            >
              Sign In
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
