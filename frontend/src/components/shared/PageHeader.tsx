import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Small context line above the title, e.g. the lifecycle stage. */
  eyebrow?: string;
}

/** Page title block. Sits inside the shell's padded container, so it adds no horizontal padding. */
export function PageHeader({ title, subtitle, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="section-label mb-1.5">{eyebrow}</p>}
        <h1 className="text-[26px] font-semibold leading-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
