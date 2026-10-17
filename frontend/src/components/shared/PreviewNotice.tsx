import type { ReactNode } from "react";
import { Info } from "lucide-react";

/** Honest note for pages that aren't connected to a backend yet. */
export function PreviewNotice({ children }: { children?: ReactNode }) {
  return (
    <div role="note" className="mb-5 flex items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px] text-text-secondary">
      <Info size={15} className="mt-0.5 shrink-0 text-text-tertiary" />
      <p>
        <span className="font-medium text-text">Beta.</span>{" "}
        {children ?? "This page uses sample results so you can try the flow. It isn't connected to a model service yet, so nothing is trained, saved or deployed."}
      </p>
    </div>
  );
}
