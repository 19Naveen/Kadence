import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";

/** Honest label for pages that aren't connected to a backend yet. */
export function PreviewNotice({ children }: { children?: ReactNode }) {
  return (
    <div role="note" className="mb-6 flex items-start gap-3 rounded-xl border border-signal/30 bg-signal-muted px-4 py-3 text-sm">
      <FlaskConical size={17} className="mt-0.5 shrink-0 text-signal" />
      <p>
        <span className="font-semibold">Preview.</span>{" "}
        <span className="text-text-secondary">
          {children ?? "This page shows sample data so you can try the flow. It isn't connected to a model backend yet, so nothing here is trained, saved or deployed."}
        </span>
      </p>
    </div>
  );
}
