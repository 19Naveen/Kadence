import { Link } from "react-router-dom";
import { BrandMark } from "../../../components/shared/BrandMark";

const linkClass = "text-sm text-text-secondary transition-colors hover:text-text";

export function LandingFooter() {
  return (
    <footer className="border-t border-border px-6 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row">
          <div className="space-y-3">
            <BrandMark size="sm" />
            <p className="max-w-xs text-sm leading-relaxed text-text-tertiary">
              A workspace for importing, shaping and querying your data.
            </p>
          </div>

          <div className="flex gap-12">
            <div className="space-y-3">
              <p className="section-label">Product</p>
              <div className="flex flex-col gap-2">
                <a href="#features" className={linkClass}>Features</a>
                <a href="#how-it-works" className={linkClass}>How it works</a>
              </div>
            </div>
            <div className="space-y-3">
              <p className="section-label">Account</p>
              <div className="flex flex-col gap-2">
                <Link to="/signup" className={linkClass}>Create account</Link>
                <Link to="/signin" className={linkClass}>Sign in</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-border-subtle pt-6">
          <p className="text-xs text-text-tertiary">© {new Date().getFullYear()} Kadence. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
