import { useState, useEffect } from "react";
import { useAuthContext } from "../../lib/context/AuthContext";

// Technical Tip: Move this to a dedicated /lib/api.ts file
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

export function AboutPage() {
  const { user, session, logout } = useAuthContext();
  
  // Profile State
  const [username, setUsername] = useState(user?.username ?? "");
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profileStatus, setProfileStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  // Password State
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [pwdStatus, setPwdStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

  // Sync state if user object updates in context
  useEffect(() => {
    if (user?.username) setUsername(user.username);
  }, [user]);

  const apiFetch = async (endpoint: string, options: RequestInit) => {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.accessToken}`,
        ...options.headers,
      },
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData?.detail ?? "An unexpected error occurred");
    }
    return res.json().catch(() => ({}));
  };

  async function handleSaveProfile() {
    if (!username.trim()) return setProfileStatus({ type: 'error', msg: "Username cannot be empty" });
    
    setLoading(true);
    setProfileStatus(null);
    try {
      await apiFetch("/auth/me", { method: "PUT", body: JSON.stringify({ username }) });
      setProfileStatus({ type: 'success', msg: "Profile updated successfully." });
      setIsEditing(false);
    } catch (err: any) {
      setProfileStatus({ type: 'error', msg: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword() {
    setPwdStatus(null);
    if (pwd.next !== pwd.confirm) return setPwdStatus({ type: 'error', msg: "Passwords do not match." });
    if (pwd.next.length < 8) return setPwdStatus({ type: 'error', msg: "Password must be at least 8 characters." });

    setLoading(true);
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: pwd.current, new_password: pwd.next }),
      });
      setPwdStatus({ type: 'success', msg: "Success. Logging out..." });
      setTimeout(logout, 1500);
    } catch (err: any) {
      setPwdStatus({ type: 'error', msg: err.message });
      setLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 max-w-6xl mx-auto p-4">
      {/* Profile Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h1 className="text-xl font-bold text-slate-900">Profile Settings</h1>
        <p className="text-sm text-slate-500 mb-6">Manage your public identity.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Username</label>
            {isEditing ? (
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-primary/20 outline-hidden transition"
              />
            ) : (
              <p className="text-sm font-medium py-2">{user?.username ?? "—"}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Email Address</label>
            <p className="text-sm text-slate-600 py-2">{user?.email ?? "—"}</p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            {isEditing ? (
              <>
                <button 
                  onClick={handleSaveProfile} 
                  disabled={loading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? "Saving..." : "Save Changes"}
                </button>
                <button 
                  onClick={() => { setIsEditing(false); setUsername(user?.username ?? ""); }} 
                  className="rounded-lg px-4 py-2 text-sm font-medium border border-slate-300 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button 
                onClick={() => setIsEditing(true)} 
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Edit Profile
              </button>
            )}
          </div>
          {profileStatus && (
            <p className={`text-sm ${profileStatus.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
              {profileStatus.msg}
            </p>
          )}
        </div>
      </section>

      {/* Password Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900">Security</h2>
        <p className="text-sm text-slate-500 mb-6">Update your password to keep your account secure.</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Current Password</label>
            <input 
              type="password" 
              autoComplete="current-password"
              value={pwd.current} 
              onChange={(e) => setPwd({...pwd, current: e.target.value})} 
              className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-hidden focus:ring-2 focus:ring-rose-500/10 transition" 
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">New Password</label>
              <input 
                type="password" 
                autoComplete="new-password"
                value={pwd.next} 
                onChange={(e) => setPwd({...pwd, next: e.target.value})} 
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-hidden focus:ring-2 focus:ring-rose-500/10" 
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Confirm</label>
              <input 
                type="password" 
                autoComplete="new-password"
                value={pwd.confirm} 
                onChange={(e) => setPwd({...pwd, confirm: e.target.value})} 
                className="w-full rounded-lg border border-slate-300 px-3 py-2 outline-hidden focus:ring-2 focus:ring-rose-500/10" 
              />
            </div>
          </div>

          <div className="pt-2">
            <button 
              onClick={handleChangePassword} 
              disabled={loading || !pwd.next}
              className="w-full md:w-auto rounded-lg bg-rose-600 px-6 py-2 text-sm font-semibold text-white hover:bg-rose-700 transition disabled:opacity-50"
            >
              {loading ? "Processing..." : "Update Password"}
            </button>
          </div>
          {pwdStatus && (
            <p className={`text-sm ${pwdStatus.type === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
              {pwdStatus.msg}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}