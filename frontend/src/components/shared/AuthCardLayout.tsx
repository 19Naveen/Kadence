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
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <main className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Link to="/" aria-label="Kadence home">
            <BrandMark size="sm" />
          </Link>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <div className="mb-5">
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle && <p className="mt-0.5 text-[13px] text-text-secondary">{subtitle}</p>}
          </div>
          {children}
        </div>

        {footer && <div className="mt-5 text-center text-[13px] text-text-secondary">{footer}</div>}
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
