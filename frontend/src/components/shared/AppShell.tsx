import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/cn";
import { useAppContext } from "../../lib/context/AppContext";
import { useAuthContext } from "../../lib/context/AuthContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";

const navGroups = [
  {
    title: "Overview",
    items: [{
      to: "/app", label: "Project Home", icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
      )
    }]
  },
  {
    title: "Data Engine",
    items: [
      {
        to: "/app/data-import", label: "Source Import", icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
        )
      },
      {
        to: "/app/data-transform", label: "Pipeline Studio", icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.675.337a4 4 0 01-2.574.345l-2.313-.463c-.574-.115-1.155.032-1.536.413l-1.119 1.119a2 2 0 01-2.828 0l-3.536-3.536a2 2 0 010-2.828l1.119-1.119a2 2 0 00.413-1.536L4.057 6.42a4 4 0 01.345-2.574l.338-.675a6 6 0 00.517-3.861L4.78 1.056a2 2 0 00-.547-1.022L2.73 2.73a2 2 0 000 2.828l3.536 3.536a2 2 0 002.828 0L9.11 9.11a2 2 0 011.536-.413l2.313.463a4 4 0 002.574-.345l.675-.338a6 6 0 013.861-.517l2.387.477a2 2 0 011.022.547l1.503 1.503z" /></svg>
        )
      }
    ]
  },
  {
    title: "Intelligence",
    items: [
      {
        to: "/app/query-studio", label: "AI Query Studio", icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
        )
      },
      {
        to: "/app/eda-dashboards", label: "Visual Dashboards", icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        )
      }
    ]
  },
  {
    title: "Predictive Models",
    items: [
      {
        to: "/app/automl-lab", label: "AutoML Lab", icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.675.337a4 4 0 01-2.574.345l-2.313-.463c-.574-.115-1.155.032-1.536.413l-1.119 1.119a2 2 0 01-2.828 0l-3.536-3.536a2 2 0 010-2.828l1.119-1.119a2 2 0 00.413-1.536L4.057 6.42a4 4 0 01.345-2.574l.338-.675a6 6 0 00.517-3.861L4.78 1.056a2 2 0 00-.547-1.022L2.73 2.73a2 2 0 000 2.828l3.536 3.536a2 2 0 002.828 0L9.11 9.11a2 2 0 011.536-.413l2.313.463a4 4 0 002.574-.345l.675-.338a6 6 0 013.861-.517l2.387.477a2 2 0 011.022.547l1.503 1.503z" /></svg>
        )
      },
      {
        to: "/app/ml-training", label: "Model Training", icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
        )
      },
      {
        to: "/app/ml-prediction", label: "Model Prediction", icon: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
        )
      }
    ]
  }
];

function navClass(isActive: boolean): string {
  return cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 group",
    isActive
      ? "bg-primary text-white shadow-md shadow-primary/10 scale-[1.02]"
      : "text-text-secondary hover:bg-surface-2 hover:text-text hover:translate-x-1"
  );
}

export function AppShell() {
  const { activeDataset } = useAppContext();
  const { workspaces, activeWorkspace, switchWorkspace, createWorkspace } = useWorkspaceContext();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false);
  const [showNewWorkspaceForm, setShowNewWorkspaceForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const navigate = useNavigate();
  const { logout } = useAuthContext();
  const workspaceBtnRef = useRef<HTMLButtonElement>(null);
  const workspaceSwitcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showWorkspaceSwitcher) return;
    const handler = (e: MouseEvent) => {
      if (
        workspaceBtnRef.current && !workspaceBtnRef.current.contains(e.target as Node) &&
        workspaceSwitcherRef.current && !workspaceSwitcherRef.current.contains(e.target as Node)
      ) {
        setShowWorkspaceSwitcher(false);
        setShowNewWorkspaceForm(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showWorkspaceSwitcher]);

  const breadcrumb = useMemo(() => {
    for (const group of navGroups) {
      for (const item of group.items) {
        if (item.to === "/app" && location.pathname === "/app") return item.label;
        if (item.to !== "/app" && location.pathname.startsWith(item.to)) return item.label;
      }
    }
    if (location.pathname.includes("workspace-settings")) return "Settings";
    return "Project Home";
  }, [location.pathname]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-bg text-text font-sans">
      {/* Sidebar - Pro Design */}
      <aside className="hidden w-[var(--sidebar-w)] shrink-0 flex-col border-r border-border bg-surface lg:flex">
        {/* Brand/Header */}
        <div className="h-[var(--header-h)] border-b border-border px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20">
              <span className="text-sm font-bold">K</span>
            </div>
            <span className="text-base font-bold tracking-tight text">Kadence</span>
          </div>
        </div>

        {/* Workspace Selector */}
        <div className="px-4 pt-6 pb-2 relative">
          <button
            ref={workspaceBtnRef}
            onClick={() => { setShowWorkspaceSwitcher((s) => !s); setShowNewWorkspaceForm(false); }}
            className="w-full text-left rounded-xl border border-border-subtle bg-surface-2/30 hover:bg-surface-2/60 px-4 py-3 transition-all group"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary mb-1">Workspace</p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text truncate">{activeWorkspace?.name ?? "Loading…"}</span>
              <svg className="w-3.5 h-3.5 text-text-tertiary group-hover:text-text transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </div>
            {activeDataset && (
              <div className="mt-2 flex items-center gap-1.5 overflow-hidden">
                <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                <span className="text-[11px] text-text-secondary truncate">{activeDataset.name}</span>
              </div>
            )}
          </button>

          {showWorkspaceSwitcher && (
            <div ref={workspaceSwitcherRef} className="absolute left-4 right-4 top-full mt-1 z-50 rounded-xl border border-border bg-white shadow-xl overflow-hidden">
              <div className="p-2 space-y-0.5">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => { switchWorkspace(ws.id); setShowWorkspaceSwitcher(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-colors",
                      ws.id === activeWorkspace?.id ? "bg-primary/10 text-primary" : "hover:bg-surface-2"
                    )}
                  >
                    <div className={cn(
                      "size-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0",
                      ws.id === activeWorkspace?.id ? "bg-primary text-white" : "bg-surface-2 text"
                    )}>
                      {ws.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{ws.name}</p>
                      <p className="text-[10px] text-text-tertiary truncate">{ws.slug}</p>
                    </div>
                    {ws.id === activeWorkspace?.id && (
                      <svg className="w-4 h-4 text-primary ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                    )}
                  </button>
                ))}
              </div>
              <div className="border-t border-border p-2">
                {showNewWorkspaceForm ? (
                  <div className="flex gap-2 p-1">
                    <input
                      autoFocus
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newWorkspaceName.trim()) {
                          createWorkspace(newWorkspaceName.trim());
                          setNewWorkspaceName("");
                          setShowNewWorkspaceForm(false);
                          setShowWorkspaceSwitcher(false);
                        }
                        if (e.key === "Escape") setShowNewWorkspaceForm(false);
                      }}
                      placeholder="Workspace name…"
                      className="input flex-1 text-sm py-1.5 px-2"
                    />
                    <button
                      onClick={() => {
                        if (newWorkspaceName.trim()) {
                          createWorkspace(newWorkspaceName.trim());
                          setNewWorkspaceName("");
                          setShowNewWorkspaceForm(false);
                          setShowWorkspaceSwitcher(false);
                        }
                      }}
                      className="btn btn-primary text-xs px-3"
                    >
                      Create
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewWorkspaceForm(true)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-text-secondary hover:bg-surface-2 flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                    New workspace
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          {navGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-text-tertiary opacity-80">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => navClass(isActive)}>
                    <span className="group-hover:scale-110 transition-transform">{item.icon}</span>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User / Bottom */}
        <div className="p-4 border-t border-border">
          <NavLink to="/app/workspace-settings" className={({ isActive }) => navClass(isActive)}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            Workspace Settings
          </NavLink>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Modern Header */}
        <header className="h-[var(--header-h)] shrink-0 px-8 flex items-center justify-between border-b border-border bg-white z-10">
          <div className="flex items-center gap-6">
            <button
              className="lg:hidden p-2 hover:bg-surface-2 rounded-xl transition-colors"
              onClick={() => setMobileMenuOpen(true)}
            >
              <svg className="w-5 h-5 text" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-tertiary font-medium">Platform</span>
              <svg className="w-4 h-4 text-text-tertiary/40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              <span className="text font-bold tracking-tight">{breadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-4 mr-4">
              <div className="px-3 py-1 rounded-full bg-success-muted text-success text-[10px] font-bold uppercase tracking-wider flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                Cluster Live
              </div>
              <div className="w-px h-4 bg-border" />
            </div>

            <div className="relative">
              <button
                aria-haspopup="true"
                aria-expanded={false}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 border border-border text-xs font-bold hover:bg-surface-3 transition-colors"
                onClick={() => { setShowUserMenu((s) => !s); setShowWorkspaceSwitcher(false); }}
              >
                {activeWorkspace?.name?.charAt(0) ?? "?"}
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-border rounded-md shadow-lg py-1 z-20">
                  <button
                    className="w-full text-left px-4 py-2 text-sm hover:bg-surface-2"
                    onClick={() => navigate("/app/about")}
                  >
                    Settings
                  </button>
                  <div className="h-px bg-border my-1" />
                  <button
                    className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-surface-2"
                    onClick={() => {
                      logout();
                      navigate("/", { replace: true });
                    }}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-[100] flex">
            <div className="w-[var(--sidebar-w)] bg-white h-full flex flex-col shadow-2xl animate-in slide-in-from-left duration-300">
              <div className="h-[var(--header-h)] border-b px-6 flex items-center justify-between">
                <span className="font-bold">Menu</span>
                <button onClick={() => setMobileMenuOpen(false)} className="p-2 hover:bg-surface-2 rounded-xl">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {navGroups.map((group) => (
                  <div key={group.title}>
                    <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-text-tertiary">{group.title}</p>
                    <div className="space-y-1">
                      {group.items.map((item) => (
                        <NavLink key={item.to} to={item.to} onClick={() => setMobileMenuOpen(false)} className={({ isActive }) => navClass(isActive)}>
                          {item.icon}
                          {item.label}
                        </NavLink>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          </div>
        )}

        <main className="flex-1 overflow-y-auto bg-bg/50 p-8">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}