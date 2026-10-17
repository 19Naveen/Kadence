import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { BrandMark } from "../../../components/shared/BrandMark";
import { useAuthContext } from "../../../lib/context/AuthContext";

const navLink = "rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-2 hover:text-text";

export function LandingNavbar() {
  const { isAuthenticated } = useAuthContext();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const close = () => setMobileOpen(false);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled || mobileOpen ? "border-b border-border bg-bg/90 backdrop-blur-xl" : "bg-transparent"
      }`}
    >
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-6">
        <Link to="/" className="shrink-0" aria-label="Kadence home">
          <BrandMark size="sm" />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          <a href="#features" className={navLink}>Features</a>
          <a href="#how-it-works" className={navLink}>How it works</a>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {isAuthenticated ? (
            <Link to="/app" className="btn btn-primary">Open app</Link>
          ) : (
            <>
              <Link to="/signin" className="btn btn-secondary">Sign in</Link>
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
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {mobileOpen && (
        <div id="landing-mobile-menu" className="space-y-2 border-b border-border bg-bg/95 px-6 py-4 backdrop-blur-xl md:hidden">
          <a href="#features" className="block py-2 text-sm font-semibold text-text-secondary" onClick={close}>Features</a>
          <a href="#how-it-works" className="block py-2 text-sm font-semibold text-text-secondary" onClick={close}>How it works</a>
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
