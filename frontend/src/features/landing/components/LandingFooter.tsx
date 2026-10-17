import { Link } from "react-router-dom";
import { BrandMark } from "../../../components/shared/BrandMark";

export function LandingFooter() {
  return (
    <footer className="border-t border-border py-12 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row items-start justify-between gap-8">
          <div className="space-y-3">
            <BrandMark size="sm" />
            <p className="text-sm text-text-tertiary max-w-xs leading-relaxed">
              AI-powered lakehouse platform for data ingestion, exploration, and ML.
            </p>
          </div>

          <div className="flex gap-12">
            <div className="space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-text-tertiary">Platform</p>
              <div className="flex flex-col gap-2">
                <a href="#features" className="text-sm text-text-secondary hover:text-text transition-colors">Features</a>
                <a href="#how-it-works" className="text-sm text-text-secondary hover:text-text transition-colors">How It Works</a>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-black uppercase tracking-widest text-text-tertiary">Account</p>
              <div className="flex flex-col gap-2">
                <Link to="/signup" className="text-sm text-text-secondary hover:text-text transition-colors">Sign Up</Link>
                <Link to="/signin" className="text-sm text-text-secondary hover:text-text transition-colors">Sign In</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border-subtle flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-text-tertiary">
            © {new Date().getFullYear()} Kadence. All rights reserved.
          </p>
          <p className="text-xs text-text-tertiary">
            Built with FastAPI · PostgreSQL · MinIO · React
          </p>
        </div>
      </div>
    </footer>
  );
}
