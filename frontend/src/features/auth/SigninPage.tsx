import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AuthCardLayout, PasswordField } from "../../components/shared/AuthCardLayout";
import { useAuthContext } from "../../lib/context/AuthContext";

/** ProtectedRoute passes the page the user was heading to as `state.from` (a Location). */
function redirectTarget(state: unknown): string {
  const from = (state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from;
  return from?.pathname ? `${from.pathname}${from.search ?? ""}${from.hash ?? ""}` : "/app";
}

export function SigninPage() {
  const { loginWithCredentials } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await loginWithCredentials({ email: email.trim(), password });
      navigate(redirectTarget(location.state), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <AuthCardLayout
      title="Welcome back"
      subtitle="Sign in to your Kadence workspace"
      footer={
        <>
          Don't have an account?{" "}
          <Link to="/signup" className="font-medium text-primary hover:underline">Create account</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="signin-email" className="field-label">Email</label>
          <input
            id="signin-email"
            type="email"
            className="input"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            autoFocus
          />
        </div>

        <PasswordField id="signin-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />

        {error && (
          <p role="alert" className="rounded-md border border-danger/20 bg-danger-muted px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        <button type="submit" disabled={isSubmitting} className="btn btn-primary mt-1 w-full">
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthCardLayout>
  );
}
