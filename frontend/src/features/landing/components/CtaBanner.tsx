import { Link } from "react-router-dom";

export function CtaBanner() {
  return (
    <section className="border-t border-border px-6 py-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold sm:text-3xl">Start with your own data</h2>
          <p className="mt-2 text-base text-text-secondary">
            Upload a file or connect a database, then shape and query it in your own workspace.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Link to="/signup" className="btn btn-primary h-9 px-4">Create account</Link>
          <Link to="/signin" className="btn btn-secondary h-9 px-4">Sign in</Link>
        </div>
      </div>
    </section>
  );
}
