import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthCardLayout } from "../../components/shared/AuthCardLayout";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";

export function OnboardingPage() {
  const { createWorkspace } = useWorkspaceContext();
  const { logout, user } = useAuthContext();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await createWorkspace(name.trim(), description.trim() || undefined);
      navigate("/app", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the workspace. Please try again.");
      setIsSubmitting(false);
    }
  }

  function handleSignOut() {
    logout();
    navigate("/signin", { replace: true });
  }

  return (
    <AuthCardLayout
      title="Create your workspace"
      subtitle="A workspace holds your data sources, pipelines and queries."
      footer={
        <>
          {user ? <>Signed in as {user.email}. </> : null}
          <button type="button" onClick={handleSignOut} className="font-semibold text-primary hover:underline">
            Sign out
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="workspace-name" className="field-label">
            Workspace name <span className="text-danger" aria-hidden="true">*</span>
          </label>
          <input
            id="workspace-name"
            type="text"
            className="input"
            placeholder="Marketing analytics"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            maxLength={64}
          />
          <p className="field-hint">You can create more workspaces later.</p>
        </div>

        <div>
          <label htmlFor="workspace-description" className="field-label">
            Description <span className="font-normal text-text-tertiary">(optional)</span>
          </label>
          <textarea
            id="workspace-description"
            className="input h-auto resize-none py-2"
            rows={3}
            placeholder="What does this workspace cover?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={256}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-danger/20 bg-danger-muted px-4 py-3 text-sm text-danger">
            {error}
          </p>
        )}

        <button type="submit" disabled={isSubmitting || !name.trim()} className="btn btn-primary h-10 w-full">
          {isSubmitting ? "Creating…" : "Create workspace"}
        </button>
      </form>
    </AuthCardLayout>
  );
}
