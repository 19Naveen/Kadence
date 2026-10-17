import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** "center" for forms and confirmations, "side" for detail panels. */
  variant?: "center" | "side";
  size?: "sm" | "md" | "lg";
  /** Block closing while work is in flight. */
  dismissible?: boolean;
}

export function Dialog({
  open, onClose, title, description, children, footer, variant = "center", size = "md", dismissible = true,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && dismissible) onClose(); };
    document.addEventListener("keydown", onKey);
    // Focus the first field, else the panel itself, so keyboard users land inside.
    const first = panelRef.current?.querySelector<HTMLElement>("[autofocus], input, select, textarea, button:not([data-dialog-close])");
    (first ?? panelRef.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      returnFocus.current?.focus?.();
    };
    // onClose identity changes every render; only (re)bind when opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dismissible]);

  if (!open) return null;

  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[size];

  return createPortal(
    <div className={cn("fixed inset-0 z-[60] flex", variant === "center" ? "items-center justify-center p-4" : "justify-end")}>
      <div className="absolute inset-0 bg-text/35 animate-fade-in" onClick={() => dismissible && onClose()} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-full w-full flex-col bg-surface shadow-soft-lg outline-none",
          variant === "center" ? cn("rounded-2xl animate-scale-in", width) : "h-full max-w-xl border-l border-border animate-fade-in",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            {description && <div className="mt-0.5 text-sm text-text-secondary">{description}</div>}
          </div>
          <button data-dialog-close className="btn-icon -mr-2 shrink-0" aria-label="Close" onClick={onClose} disabled={!dismissible}>
            <X size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-3.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
