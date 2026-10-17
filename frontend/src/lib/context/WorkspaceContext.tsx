import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuthContext } from "./AuthContext";
import { readError } from "../http";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string;
  owner_id: string;
  created_at: string;
}

interface WorkspaceContextValue {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  /** True from sign-in until the first workspace list has arrived (or failed). */
  isLoading: boolean;
  /** Last list/refresh failure, or null. Cleared on the next successful fetch. */
  error: string | null;
  switchWorkspace: (id: string) => void;
  /** Throws an Error with a readable message on failure. */
  createWorkspace: (name: string, description?: string) => Promise<Workspace>;
  /** Throws an Error with a readable message on failure. Cascades to the workspace's datasets. */
  deleteWorkspace: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

const WorkspaceCtx = createContext<WorkspaceContextValue | undefined>(undefined);

/** fetch that always throws a readable Error (network failure, non-JSON 502, FastAPI 422 arrays). */
async function call(url: string, init: RequestInit, fallback: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(await readError(res, `${fallback} (HTTP ${res.status}).`));
  return res;
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuthContext();
  const token = session?.accessToken ?? null;
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  // Token the current list was fetched for; loading until it matches the live token.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const headers = useCallback(
    () => ({ "Content-Type": "application/json", Authorization: `Bearer ${token}` }),
    [token]
  );

  const fetchWorkspaces = useCallback(async () => {
    if (!token) {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      setError(null);
      setLoadedFor(null);
      return;
    }
    try {
      const res = await call(`${API_BASE}/workspaces`, { headers: headers() }, "Couldn't load your workspaces");
      const data: Workspace[] = await res.json();
      if (tokenRef.current !== token) return; // signed out / switched account mid-flight
      setWorkspaces(data);
      setError(null);
      // Keep the active workspace if it still exists, else fall back to the first.
      setActiveWorkspaceId((prev) => (prev && data.some((w) => w.id === prev) ? prev : data[0]?.id ?? null));
    } catch (e) {
      if (tokenRef.current !== token) return;
      setError(e instanceof Error ? e.message : "Couldn't load your workspaces.");
    } finally {
      if (tokenRef.current === token) setLoadedFor(token);
    }
  }, [token, headers]);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  const switchWorkspace = useCallback((id: string) => setActiveWorkspaceId(id), []);

  const createWorkspace = useCallback(
    async (name: string, description?: string): Promise<Workspace> => {
      const res = await call(
        `${API_BASE}/workspaces`,
        { method: "POST", headers: headers(), body: JSON.stringify({ name, description }) },
        "Couldn't create the workspace"
      );
      const ws: Workspace = await res.json();
      setWorkspaces((prev) => [...prev, ws]);
      setActiveWorkspaceId(ws.id);
      return ws;
    },
    [headers]
  );

  const deleteWorkspace = useCallback(
    async (id: string): Promise<void> => {
      await call(`${API_BASE}/workspaces/${id}`, { method: "DELETE", headers: headers() }, "Couldn't delete the workspace");
      const remaining = workspaces.filter((w) => w.id !== id);
      setWorkspaces(remaining);
      setActiveWorkspaceId((prev) => (prev === id || !remaining.some((w) => w.id === prev) ? remaining[0]?.id ?? null : prev));
    },
    [headers, workspaces]
  );

  const isLoading = token !== null && loadedFor !== token;
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0] ?? null;

  return (
    <WorkspaceCtx.Provider
      value={{ workspaces, activeWorkspace, isLoading, error, switchWorkspace, createWorkspace, deleteWorkspace, refetch: fetchWorkspaces }}
    >
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspaceContext(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspaceContext must be used within WorkspaceProvider");
  return ctx;
}
