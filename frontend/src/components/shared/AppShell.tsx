import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BrainCircuit, ChartColumn, Check, ChevronsUpDown, Database, FlaskConical, House, LoaderCircle, LogOut,
  Menu, PanelLeftClose, PanelLeftOpen, Plus, Settings, SquareTerminal, Target, UserRound, Workflow, X,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { ErrorBoundary } from "./ErrorBoundary";
import { PageLoading } from "./PageLoading";

const navGroups = [
  { title: null, items: [{ to: "/app", label: "Home", Icon: House, end: true }] },
  {
    title: "Data",
    items: [
      { to: "/app/data-import", label: "Data sources", Icon: Database },
      { to: "/app/data-transform", label: "Pipeline Studio", Icon: Workflow },
    ],
  },
  {
    title: "Analyze",
    items: [
      { to: "/app/query-studio", label: "Query Studio", Icon: SquareTerminal },
      { to: "/app/eda-dashboards", label: "Dashboards", Icon: ChartColumn },
    ],
  },
  {
    title: "Models · beta",
    items: [
      { to: "/app/automl-lab", label: "AutoML Lab", Icon: FlaskConical },
      { to: "/app/ml-training", label: "Model training", Icon: BrainCircuit },
      { to: "/app/ml-prediction", label: "Predictions", Icon: Target },
    ],
  },
] as const;

/** Routes that manage their own full-height layout (no page padding / max width). */
const FULL_BLEED = ["/app/data-transform", "/app/query-studio"];
const COLLAPSE_KEY = "kadence.sidebar.collapsed";

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
}

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
    // refs are stable objects; close is only read inside the handlers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
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

  const initial = activeWorkspace?.name.charAt(0).toUpperCase() ?? "·";

  return (
    <div className="relative min-w-0 flex-1">
      <button
        ref={btnRef}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={collapsed ? activeWorkspace?.name : undefined}
        className={cn("flex h-9 w-full items-center gap-2 rounded-md text-left transition-colors hover:bg-surface-3", collapsed ? "justify-center px-0" : "px-2")}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-text text-[11px] font-semibold text-surface">{initial}</span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{activeWorkspace?.name ?? "Loading…"}</span>
            <ChevronsUpDown size={14} className="shrink-0 text-text-tertiary" />
          </>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-surface shadow-soft-lg animate-scale-in"
        >
          <p className="px-3 pb-1 pt-2.5 text-xs text-text-tertiary">Workspaces</p>
          <ul role="listbox" aria-label="Workspaces" className="max-h-64 overflow-y-auto px-1.5 pb-1.5">
            {workspaces.map((ws) => {
              const active = ws.id === activeWorkspace?.id;
              return (
                <li key={ws.id}>
                  <button
                    role="option"
                    aria-selected={active}
                    onClick={() => { switchWorkspace(ws.id); close(); }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{ws.name}</span>
                    {active && <Check size={14} className="shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border p-1.5">
            {creating ? (
              <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-2 p-1">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Workspace name" aria-label="New workspace name" className="input" />
                {error && <p className="text-xs text-danger">{error}</p>}
                <div className="flex justify-end gap-1">
                  <button type="button" onClick={() => setCreating(false)} className="btn btn-ghost btn-sm">Cancel</button>
                  <button type="submit" disabled={!name.trim() || busy} className="btn btn-primary btn-sm">
                    {busy && <LoaderCircle size={12} className="animate-spin" />} Create
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => setCreating(true)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-text-secondary hover:bg-surface-2 hover:text-text">
                <Plus size={14} /> New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
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
        title={collapsed ? user?.username : undefined}
        className={cn("flex h-10 w-full items-center gap-2.5 rounded-md text-left transition-colors hover:bg-surface-3", collapsed ? "justify-center" : "px-2")}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-text">
          {user?.username.charAt(0).toUpperCase() ?? "?"}
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{user?.username ?? "Signed in"}</span>
            <span className="block truncate text-xs text-text-tertiary">{user?.email}</span>
          </span>
        )}
      </button>
      {open && (
        <div ref={panelRef} role="menu" className="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-lg border border-border bg-surface p-1.5 shadow-soft-lg animate-scale-in">
          <MenuItem icon={<UserRound size={14} />} onClick={() => go("/app/about")}>Your profile</MenuItem>
          <MenuItem icon={<Settings size={14} />} onClick={() => go("/app/workspace-settings")}>Workspace settings</MenuItem>
          <div className="my-1 h-px bg-border" />
          <MenuItem icon={<LogOut size={14} />} danger onClick={() => { setOpen(false); logout(); navigate("/", { replace: true }); }}>
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
      className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-surface-2", danger ? "text-danger" : "text-text")}
    >
      {icon}
      {children}
    </button>
  );
}

function SidebarContent({ collapsed, onToggle, onNavigate }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  return (
    <>
      <div className={cn("flex items-center gap-1 pt-2.5", collapsed ? "flex-col px-2" : "px-2.5")}>
        <WorkspaceSwitcher collapsed={collapsed} />
        {onToggle && (
          <button
            className="btn-icon shrink-0 text-text-tertiary"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>

      <div className={cn("pt-3", collapsed ? "px-2" : "px-2.5")}>
        <Link
          to="/app/data-import"
          onClick={onNavigate}
          title={collapsed ? "Add data" : undefined}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md border border-border bg-surface text-[13px] font-medium text-text shadow-soft-sm transition-colors hover:bg-surface-2",
            collapsed ? "justify-center" : "px-2.5",
          )}
        >
          <Plus size={15} /> {!collapsed && "Add data"}
        </Link>
      </div>

      <nav aria-label="Main" className={cn("mt-3 flex-1 overflow-y-auto pb-3", collapsed ? "px-2" : "px-2.5")}>
        {navGroups.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && (collapsed ? "mt-2 border-t border-border pt-2" : "mt-4"))}>
            {group.title && !collapsed && <p className="mb-1 px-2 text-xs text-text-tertiary">{group.title}</p>}
            <ul className="space-y-px">
              {group.items.map(({ to, label, Icon, ...rest }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={"end" in rest}
                    onClick={onNavigate}
                    title={collapsed ? label : undefined}
                    aria-label={collapsed ? label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "flex h-8 items-center gap-2.5 rounded-md text-[13.5px] transition-colors",
                        collapsed ? "justify-center" : "px-2",
                        isActive ? "bg-surface-3 font-medium text-text" : "text-text-secondary hover:bg-surface-3/60 hover:text-text",
                      )
                    }
                  >
                    <Icon size={16} strokeWidth={1.75} className="shrink-0" />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("border-t border-border py-2", collapsed ? "px-2" : "px-2.5")}>
        <UserMenu collapsed={collapsed} />
      </div>
    </>
  );
}

export function AppShell() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const fullBleed = FULL_BLEED.some((p) => location.pathname.startsWith(p));

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try { localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1"); } catch { /* storage unavailable */ }
      return !c;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b" && !(e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) {
        e.preventDefault();
        toggle();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-text">
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-border bg-surface-2 transition-[width] duration-150 lg:flex",
          collapsed ? "w-(--sidebar-rail)" : "w-(--sidebar-w)",
        )}
      >
        <SidebarContent collapsed={collapsed} onToggle={toggle} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <aside className="flex w-[min(var(--sidebar-w),85vw)] flex-col bg-surface-2 shadow-soft-lg animate-fade-in">
            <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
          <button aria-label="Close navigation" className="flex-1 bg-text/30" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-(--header-h) shrink-0 items-center gap-2 border-b border-border bg-surface px-3 lg:hidden">
          <button className="btn-icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className="text-sm font-semibold">Kadence</span>
        </header>

        <main className={cn("min-h-0 flex-1", fullBleed ? "flex flex-col overflow-hidden" : "overflow-y-auto")}>
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={<PageLoading />}>
              {fullBleed ? (
                <Outlet />
              ) : (
                <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
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
