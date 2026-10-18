import { steps } from "../landingContent";

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-t border-border px-6 py-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="mb-10 max-w-2xl text-2xl font-semibold sm:text-3xl">From file to answer in four steps</h2>

        <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {steps.map((step) => (
            <li key={step.title} className="border-t border-text pt-4">
              <h3 className="text-[15px] font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
