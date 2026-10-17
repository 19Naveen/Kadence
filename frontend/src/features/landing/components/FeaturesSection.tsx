import { features } from "../landingContent";

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-20 px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 space-y-4 text-center">
          <p className="section-label text-primary">What you can do</p>
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">From raw files to answers</h2>
          <p className="mx-auto max-w-2xl text-lg text-text-secondary">
            Import, shape and query your data in one workspace, with every version kept.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ Icon, title, description, soon }) => (
            <div key={title} className="card card-hover space-y-4 p-6">
              <div className="flex items-start justify-between">
                <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-primary-muted text-primary">
                  <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                </div>
                {soon && <span className="badge bg-signal-muted text-signal">Coming soon</span>}
              </div>
              <div>
                <h3 className="mb-1.5 text-base font-semibold tracking-tight">{title}</h3>
                <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
