import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthCardLayout } from "../../components/shared/AuthCardLayout";
import { useAuthContext } from "../../lib/context/AuthContext";

export function SigninPage() {
  const { loginWithCredentials } = useAuthContext();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      await loginWithCredentials({ email, password });
      navigate("/app", { replace: true });
    } catch (err: any) {
      setError(err.message ?? "Sign in failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCardLayout
      title="Welcome back"
      subtitle="Sign in to your Kadence workspace"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
            Email
          </label>
          <input
            type="email"
            className="input w-full"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">
            Password
          </label>
          <input
            type="password"
            className="input w-full"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="text-sm text-danger bg-danger-muted border border-danger/20 rounded-lg px-4 py-3">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="btn btn-primary w-full py-2.5 mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? "Signing in…" : "Sign In"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-text-secondary">
        Don't have an account?{" "}
        <Link to="/signup" className="font-semibold text-accent hover:underline">
          Get started free
        </Link>
      </p>
    </AuthCardLayout>
  );
}
