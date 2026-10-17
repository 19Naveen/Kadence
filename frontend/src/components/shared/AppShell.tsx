import { Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BrainCircuit, ChartColumn, Check, ChevronDown, FlaskConical, House, Info, LoaderCircle, LogOut,
  Menu, MessageSquareText, Plus, Settings, Target, Upload, Workflow, X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { PageLoading } from "./PageLoading";

/* Navigation follows the data lifecycle: bring data in, shape it, ask it questions, model it. */
const navGroups = [
  { title: null, items: [{ to: "/app", label: "Home", Icon: House, end: true }] },
  { title: "Bring in", items: [{ to: "/app/data-import", label: "Data sources", Icon: Upload }] },
  { title: "Shape", items: [{ to: "/app/data-transform", label: "Pipeline Studio", Icon: Workflow }] },
  {
    title: "Ask",
    items: [
      { to: "/app/query-studio", label: "Query Studio", Icon: MessageSquareText },
      { to: "/app/eda-dashboards", label: "Dashboards", Icon: ChartColumn },
    ],
  },
  {
    title: "Model",
    items: [
      { to: "/app/automl-lab", label: "AutoML Lab", Icon: FlaskConical, preview: true },
      { to: "/app/ml-training", label: "Model training", Icon: BrainCircuit, preview: true },
      { to: "/app/ml-prediction", label: "Predictions", Icon: Target, preview: true },
    ],
  },
] as const;

/** Routes that manage their own full-height layout (no page padding / max width). */
const FULL_BLEED = ["/app/data-transform", "/app/query-studio"];

function useDismiss(open: boolean, close: () => void, refs: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (refs.every((r) => r.current && !r.current.contains(e.target as Node))) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
    // refs are stable objects; close is recreated each render but only read on events
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

function WorkspaceSwitcher() {
  const { workspaces, activeWorkspace, switchWorkspace, createWorkspace } = useWorkspaceContext();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = () => { setOpen(false); setCreating(false); setError(""); };
  useDismiss(open, close, [btnRef, panelRef]);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const ws = await createWorkspace(name.trim());
      switchWorkspace(ws.id);
      setName("");
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the workspace");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative px-3">
      <button
        ref={btnRef}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-muted text-xs font-bold text-primary">
          {activeWorkspace?.name.charAt(0).toUpperCase() ?? "·"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-text-tertiary">Workspace</span>
          <span className="block truncate text-sm font-semibold">{activeWorkspace?.name ?? "Loading…"}</span>
        </span>
        <ChevronDown size={15} className={cn("shrink-0 text-text-tertiary transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-soft-lg animate-scale-in"
        >
          <ul role="listbox" aria-label="Workspaces" className="max-h-64 overflow-y-auto p-1.5">
            {workspaces.map((ws) => {
              const active = ws.id === activeWorkspace?.id;
              return (
                <li key={ws.id}>
                  <button
                    role="option"
                    aria-selected={active}
                    onClick={() => { switchWorkspace(ws.id); close(); }}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                      active ? "bg-primary-muted text-primary" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{ws.name}</span>
                    {active && <Check size={15} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border p-1.5">
            {creating ? (
              <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-2 p-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Workspace name"
                  aria-label="New workspace name"
                  className="input h-8"
                />
                {error && <p className="text-xs text-danger">{error}</p>}
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setCreating(false)} className="btn btn-ghost btn-sm">Cancel</button>
                  <button type="submit" disabled={!name.trim() || busy} className="btn btn-primary btn-sm">
                    {busy && <LoaderCircle size={13} className="animate-spin" />} Create workspace
                  </button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text"
              >
                <Plus size={15} /> New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuthContext();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [btnRef, panelRef]);

  const go = (to: string) => { setOpen(false); navigate(to); };

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-text text-xs font-bold text-surface">
          {user?.username.charAt(0).toUpperCase() ?? "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{user?.username ?? "Signed in"}</span>
          <span className="block truncate text-xs text-text-tertiary">{user?.email}</span>
        </span>
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-soft-lg animate-scale-in"
        >
          <MenuItem icon={<Settings size={15} />} onClick={() => go("/app/workspace-settings")}>Workspace settings</MenuItem>
          <MenuItem icon={<Info size={15} />} onClick={() => go("/app/about")}>Your profile</MenuItem>
          <div className="my-1 h-px bg-border" />
          <MenuItem
            icon={<LogOut size={15} />}
            danger
            onClick={() => { setOpen(false); logout(); navigate("/", { replace: true }); }}
          >
            Sign out
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-surface-2",
        danger ? "text-danger" : "text-text",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex h-(--header-h) shrink-0 items-center gap-2.5 px-5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary font-heading text-sm font-bold text-white">K</span>
        <span className="font-heading text-[17px] font-semibold tracking-tight">Kadence</span>
      </div>

      <WorkspaceSwitcher />

      <nav aria-label="Main" className="mt-3 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {group.title && <p className="section-label mb-1.5 px-2">{group.title}</p>}
            <ul className="space-y-0.5">
              {group.items.map(({ to, label, Icon, ...rest }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={"end" in rest}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "relative flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary-muted text-primary before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-full before:bg-primary"
                          : "text-text-secondary hover:bg-surface-2 hover:text-text",
                      )
                    }
                  >
                    <Icon size={16} strokeWidth={1.75} />
                    {label}
                    {"preview" in rest && (
                      <span className="ml-auto rounded px-1 text-[10px] font-semibold uppercase tracking-wide text-signal" title="Sample data — not connected to a backend yet">
                        Preview
                      </span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <UserMenu />
      </div>
    </>
  );
}

export function AppShell() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const fullBleed = FULL_BLEED.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-text">
      <aside className="hidden w-(--sidebar-w) shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <aside className="flex w-[min(var(--sidebar-w),85vw)] flex-col bg-surface shadow-soft-lg animate-fade-in">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
          <button aria-label="Close navigation" className="flex-1 bg-text/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-(--header-h) shrink-0 items-center gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <button className="btn-icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className="font-heading text-base font-semibold">Kadence</span>
        </header>

        <main className={cn("min-h-0 flex-1", fullBleed ? "flex flex-col overflow-hidden" : "overflow-y-auto")}>
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageLoading />}>
              {fullBleed ? (
                <Outlet />
              ) : (
                <div className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
                  <Outlet />
                </div>
              )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
