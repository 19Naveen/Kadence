import { Info } from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { PageLoading } from "../../components/shared/PageLoading";
import { formatDate } from "../../lib/format";
import { useAuthContext } from "../../lib/context/AuthContext";

const PROVIDER_LABELS = {
  local: "Email and password",
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
} as const;

export function AboutPage() {
  const { user, isLoading } = useAuthContext();

  if (isLoading) return <PageLoading />;
  if (!user) {
    return (
      <>
        <PageHeader title="Your profile" />
        <p className="text-sm text-text-secondary">Sign in to see your profile.</p>
      </>
    );
  }

  const rows: { label: string; value: string }[] = [
    { label: "Username", value: user.username },
    { label: "Email", value: user.email },
    { label: "Sign-in method", value: PROVIDER_LABELS[user.authProvider] ?? user.authProvider },
    { label: "Account created", value: formatDate(user.createdAt) },
  ];

  return (
    <div className="max-w-2xl">
      <PageHeader title="Your profile" subtitle="The details Kadence holds for your account." />

      <section className="rounded-lg border border-border bg-surface" aria-label="Account details">
        <dl className="divide-y divide-border-subtle">
          {rows.map((r) => (
            <div key={r.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
              <dt className="text-[13px] text-text-secondary">{r.label}</dt>
              <dd className="min-w-0 break-words text-[13px] font-medium text-text">{r.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div role="note" className="mt-4 flex items-start gap-2.5 rounded-md border border-border bg-surface-2 px-3 py-2.5 text-[13px]">
        <Info size={15} className="mt-0.5 shrink-0 text-text-tertiary" />
        <p className="text-text-secondary">
          Editing your profile and changing your password aren't available yet. These details are read-only for now.
        </p>
      </div>
    </div>
  );
}
