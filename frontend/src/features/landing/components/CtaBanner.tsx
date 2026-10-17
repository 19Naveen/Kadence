import { Link } from "react-router-dom";

export function CtaBanner() {
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-4xl">
        <div
          className="card relative overflow-hidden border-primary/20 p-12 text-center"
          style={{ background: "radial-gradient(ellipse 80% 100% at 50% 0%, hsl(var(--primary) / 0.1), transparent)" }}
        >
          <p className="section-label mb-4 text-primary">Get started</p>
          <h2 className="mb-4 text-4xl font-semibold tracking-tight sm:text-5xl">Start with your own data</h2>
          <p className="mx-auto mb-8 max-w-xl text-lg text-text-secondary">
            Upload a file or connect a database, then shape and query it in your own workspace.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link to="/signup" className="btn btn-primary h-11 px-8 text-base">Create account</Link>
            <Link to="/signin" className="btn btn-secondary h-11 px-8 text-base">Sign in</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
