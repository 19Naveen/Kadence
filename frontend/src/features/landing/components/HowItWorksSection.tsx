import { steps } from "../landingContent";

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="scroll-mt-20 bg-surface/30 px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 space-y-4 text-center">
          <p className="section-label text-primary">How it works</p>
          <h2 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            From file to answer <br className="hidden sm:block" />
            in four steps
          </h2>
        </div>

        {/* Desktop layout */}
        <div className="hidden md:block">
          <div className="relative grid grid-cols-4">
            {/* One line behind all circles */}
            <div className="absolute left-[12.5%] right-[12.5%] top-1/2 h-px -translate-y-1/2 bg-primary/20" />
            {steps.map((step) => (
              <div key={step.number} className="flex justify-center">
                <div className="relative z-10 flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-surface-2 shadow-soft-md">
                  <span className="font-heading text-xl font-semibold text-primary">{step.number}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-4 gap-4">
            {steps.map((step) => (
              <div key={step.number} className="px-3 text-center">
                <h3 className="text-sm font-semibold tracking-tight">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Mobile layout */}
        <div className="space-y-0 md:hidden">
          {steps.map((step, idx) => (
            <div key={step.number} className="flex flex-col items-center">
              <div className="flex w-full max-w-sm items-center gap-4">
                <div className="flex shrink-0 flex-col items-center">
                  {idx > 0 && <div className="h-6 w-px bg-primary/20" />}
                  <div className="flex size-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary-muted">
                    <span className="font-heading text-lg font-semibold text-primary">{step.number}</span>
                  </div>
                  {idx < steps.length - 1 && <div className="h-6 w-px bg-primary/20" />}
                </div>
                <div className="py-4">
                  <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-text-secondary">{step.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
