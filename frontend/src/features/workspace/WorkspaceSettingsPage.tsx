import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import { Dialog } from "../../components/shared/Dialog";
import { PageHeader } from "../../components/shared/PageHeader";
import { PageLoading } from "../../components/shared/PageLoading";
import { formatDate } from "../../lib/format";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";

export function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { activeWorkspace: ws, workspaces, isLoading, error: loadError, deleteWorkspace, refetch } = useWorkspaceContext();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (isLoading) return <PageLoading />;

  if (!ws) {
    return (
      <>
        <PageHeader title="Workspace settings" />
        {loadError ? (
          <div role="alert" className="card flex flex-col items-start gap-3 border-danger/30 bg-danger-muted">
            <p className="text-sm text-danger">{loadError}</p>
            <button className="btn btn-secondary btn-sm" onClick={() => void refetch()}>Try again</button>
          </div>
        ) : (
          <div className="card flex flex-col items-start gap-3">
            <p className="text-sm text-text-secondary">You don't have a workspace yet.</p>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/onboarding")}>Create workspace</button>
          </div>
        )}
      </>
    );
  }

  const isOwner = Boolean(user) && ws.owner_id === user?.id;
  const nameMatches = typed.trim() === ws.name;

  function openConfirm() {
    setTyped("");
    setError("");
    setConfirmOpen(true);
  }

  function closeConfirm() {
    if (!busy) setConfirmOpen(false);
  }

  async function handleDelete(e: FormEvent) {
    e.preventDefault();
    if (!ws || !nameMatches || busy) return;
    setBusy(true);
    setError("");
    const wasLast = workspaces.length <= 1;
    try {
      await deleteWorkspace(ws.id);
      setConfirmOpen(false);
      // The context has already switched to another workspace, if one is left.
      if (wasLast) navigate("/onboarding", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete the workspace. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const details: { label: string; value: React.ReactNode }[] = [
    { label: "Name", value: ws.name },
    { label: "Slug", value: <span className="font-mono text-[13px]">{ws.slug}</span> },
    ...(ws.description ? [{ label: "Description", value: ws.description }] : []),
    { label: "Created", value: formatDate(ws.created_at) },
    {
      label: "Your role",
      value: isOwner ? (
        <span className="badge bg-primary-muted text-primary">Owner</span>
      ) : (
        <span className="badge bg-surface-2 text-text-secondary">Member</span>
      ),
    },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Workspace settings" subtitle={`Details for ${ws.name}.`} />

      <section aria-labelledby="general-heading" className="card p-0">
        <div className="border-b border-border-subtle px-6 py-4">
          <h2 id="general-heading" className="text-base font-semibold">General</h2>
          <p className="mt-0.5 text-xs text-text-secondary">Renaming a workspace isn't available yet.</p>
        </div>
        <dl className="divide-y divide-border-subtle">
          {details.map((d) => (
            <div key={d.label} className="grid gap-1 px-6 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
              <dt className="text-sm text-text-secondary">{d.label}</dt>
              <dd className="min-w-0 break-words text-sm font-medium text-text">{d.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="danger-heading" className="card border-danger/30 p-0">
        <div className="border-b border-danger/20 px-6 py-4">
          <h2 id="danger-heading" className="text-base font-semibold text-danger">Danger zone</h2>
        </div>
        <div className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">Delete this workspace</p>
            <p className="mt-0.5 text-sm text-text-secondary">
              Permanently removes the workspace and every dataset in it. This can't be undone.
              {!isOwner && " Only the workspace owner can do this."}
            </p>
          </div>
          <button className="btn btn-danger shrink-0" onClick={openConfirm} disabled={!isOwner}>Delete workspace</button>
        </div>
      </section>

      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        dismissible={!busy}
        size="sm"
        title="Delete workspace"
        description={<>This permanently deletes <span className="font-semibold text-text">{ws.name}</span> and all of its datasets.</>}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={closeConfirm} disabled={busy}>Cancel</button>
            <button type="submit" form="delete-workspace-form" className="btn btn-danger" disabled={!nameMatches || busy}>
              {busy ? "Deleting…" : "Delete workspace"}
            </button>
          </>
        }
      >
        <form id="delete-workspace-form" onSubmit={handleDelete} className="space-y-4">
          <div role="note" className="flex items-start gap-3 rounded-lg bg-danger-muted px-3 py-2.5 text-sm text-danger">
            <TriangleAlert size={16} className="mt-0.5 shrink-0" />
            <p>Uploaded files and every dataset version in this workspace are deleted with it.</p>
          </div>
          <div>
            <label htmlFor="confirm-workspace-name" className="field-label">
              Type <span className="font-mono text-[13px]">{ws.name}</span> to confirm
            </label>
            <input
              id="confirm-workspace-name"
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </form>
      </Dialog>
    </div>
  );
}
