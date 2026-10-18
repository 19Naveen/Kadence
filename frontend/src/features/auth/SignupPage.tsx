import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthCardLayout, PasswordField } from "../../components/shared/AuthCardLayout";
import { useAuthContext } from "../../lib/context/AuthContext";

const MIN_PASSWORD = 8;

export function SignupPage() {
  const { signupWithCredentials } = useAuthContext();
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    try {
      await signupWithCredentials({ username: username.trim(), email: email.trim(), password });
      navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <AuthCardLayout
      title="Create your account"
      subtitle="Start with a workspace for your data"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/signin" className="font-medium text-primary hover:underline">Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="signup-username" className="field-label">Username</label>
          <input
            id="signup-username"
            type="text"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="signup-email" className="field-label">Email</label>
          <input
            id="signup-email"
            type="email"
            className="input"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <PasswordField
          id="signup-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters.`}
        />

        <div>
          <PasswordField
            id="signup-confirm"
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />
          {mismatch && <p role="alert" className="mt-1 text-xs text-danger">Passwords don't match.</p>}
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-danger/20 bg-danger-muted px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        <button type="submit" disabled={isSubmitting} className="btn btn-primary mt-1 w-full">
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthCardLayout>
  );
}
