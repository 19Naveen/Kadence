import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Kept for API compatibility; titles stand on their own. */
  eyebrow?: string;
}

/** Page title block. Sits inside the shell's padded container, so it adds no horizontal padding. */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold leading-7 text-text">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-2xl text-[13px] text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
