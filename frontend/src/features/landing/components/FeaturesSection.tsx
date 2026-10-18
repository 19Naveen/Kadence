import { features } from "../landingContent";

export function FeaturesSection() {
  return (
    <section id="features" className="scroll-mt-16 border-t border-border px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-2xl font-semibold sm:text-3xl">From raw files to answers</h2>
          <p className="mt-2 text-base text-text-secondary">
            Import, shape and query your data in one workspace, with every version kept.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ Icon, title, description, soon }) => (
            <div key={title} className="bg-surface p-6">
              <div className="mb-3 flex items-center gap-2">
                <Icon size={16} className="text-text-tertiary" aria-hidden="true" />
                <h3 className="text-[15px] font-semibold">{title}</h3>
                {soon && <span className="badge ml-auto bg-surface-2 text-text-secondary">Coming soon</span>}
              </div>
              <p className="text-sm leading-relaxed text-text-secondary">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
