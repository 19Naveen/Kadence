import { ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { BrandMark } from "./BrandMark";

interface AuthCardLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Content under the card, e.g. a link to the other auth page. */
  footer?: ReactNode;
}

export function AuthCardLayout({ children, title, subtitle, footer }: AuthCardLayoutProps) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-bg px-4 py-10">
      {/* Soft teal wash and faint grid, both token-driven so dark mode follows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, hsl(var(--primary) / 0.08) 0%, transparent 70%)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--text)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--text)) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      <main className="w-full max-w-md animate-slide-up">
        <div className="mb-8 flex justify-center">
          <Link to="/" aria-label="Kadence home">
            <BrandMark size="lg" />
          </Link>
        </div>

        <div className="card p-8 shadow-soft-lg">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
          </div>
          {children}
        </div>

        {footer && <div className="mt-6 text-center text-sm text-text-secondary">{footer}</div>}
      </main>
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  hint?: string;
}

/** Password input with a show/hide toggle, shared by the sign-in and sign-up forms. */
export function PasswordField({ id, label, value, onChange, autoComplete, minLength, hint }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          className="input pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          aria-describedby={hint ? `${id}-hint` : undefined}
          required
        />
        <button
          type="button"
          className="btn-icon absolute right-0.5 top-0.5"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint && <p id={`${id}-hint`} className="field-hint">{hint}</p>}
    </div>
  );
}
