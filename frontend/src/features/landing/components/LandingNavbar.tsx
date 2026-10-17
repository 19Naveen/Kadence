import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandMark } from "../../../components/shared/BrandMark";
import { useAuthContext } from "../../../lib/context/AuthContext";

export function LandingNavbar() {
  const { isAuthenticated } = useAuthContext();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-bg/90 backdrop-blur-xl border-b border-border shadow-xs"
          : "bg-transparent"
      }`}
    >
      <nav className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
        {/* Logo */}
        <Link to="/" className="shrink-0">
          <BrandMark size="sm" />
        </Link>

        {/* Center nav */}
        <div className="hidden md:flex items-center gap-1">
          <a
            href="#features"
            className="px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-2"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text transition-colors rounded-lg hover:bg-surface-2"
          >
            How It Works
          </a>
        </div>

        {/* Right CTA */}
        <div className="hidden md:flex items-center gap-3">
          {isAuthenticated ? (
            <Link to="/app" className="btn btn-primary text-sm px-5">
              Go to App →
            </Link>
          ) : (
            <>
              <Link
                to="/signin"
                className="btn btn-secondary text-sm px-5"
              >
                Sign In
              </Link>
              <Link
                to="/signup"
                className="btn btn-primary text-sm px-5"
              >
                Get Started Free
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden p-2 rounded-lg hover:bg-surface-2 transition-colors"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-bg/95 backdrop-blur-xl border-b border-border px-6 py-4 space-y-2">
          <a href="#features" className="block py-2 text-sm font-semibold text-text-secondary" onClick={() => setMobileOpen(false)}>Features</a>
          <a href="#how-it-works" className="block py-2 text-sm font-semibold text-text-secondary" onClick={() => setMobileOpen(false)}>How It Works</a>
          <div className="pt-2 flex flex-col gap-2">
            {isAuthenticated ? (
              <Link to="/app" className="btn btn-primary text-sm text-center">Go to App →</Link>
            ) : (
              <>
                <Link to="/signin" className="btn btn-secondary text-sm text-center">Sign In</Link>
                <Link to="/signup" className="btn btn-primary text-sm text-center">Get Started Free</Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
