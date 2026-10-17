import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";

export function PageLoading({ fullScreen }: { fullScreen?: boolean }) {
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 text-sm text-text-tertiary", fullScreen ? "h-dvh" : "py-24")}>
      <LoaderCircle size={16} className="animate-spin" /> Loading…
    </div>
  );
}
