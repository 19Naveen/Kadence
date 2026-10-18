import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { BrandMark } from "../../../components/shared/BrandMark";
import { useAuthContext } from "../../../lib/context/AuthContext";

export function LandingNavbar() {
  const { isAuthenticated } = useAuthContext();
  const [mobileOpen, setMobileOpen] = useState(false);
  const close = () => setMobileOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-6 px-6">
        <div className="flex items-center gap-6">
          <Link to="/" className="shrink-0" aria-label="Kadence home">
            <BrandMark size="sm" />
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <a href="#features" className="btn btn-ghost">Features</a>
            <a href="#how-it-works" className="btn btn-ghost">How it works</a>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {isAuthenticated ? (
            <Link to="/app" className="btn btn-primary">Open app</Link>
          ) : (
            <>
              <Link to="/signin" className="btn btn-ghost">Sign in</Link>
              <Link to="/signup" className="btn btn-primary">Create account</Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="btn-icon md:hidden"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          aria-controls="landing-mobile-menu"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {mobileOpen && (
        <div id="landing-mobile-menu" className="space-y-1 border-t border-border px-6 py-3 md:hidden">
          <a href="#features" className="block py-2 text-sm text-text-secondary" onClick={close}>Features</a>
          <a href="#how-it-works" className="block py-2 text-sm text-text-secondary" onClick={close}>How it works</a>
          <div className="flex flex-col gap-2 pt-2">
            {isAuthenticated ? (
              <Link to="/app" className="btn btn-primary" onClick={close}>Open app</Link>
            ) : (
              <>
                <Link to="/signin" className="btn btn-secondary" onClick={close}>Sign in</Link>
                <Link to="/signup" className="btn btn-primary" onClick={close}>Create account</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
