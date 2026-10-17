import { useState } from "react";
import {
  Settings,
  CreditCard,
  Plug,
  Shield,
  Bell,
  Key,
  Globe,
  Database,
  Building2,
  ChevronRight,
  Check,
  AlertCircle,
  Copy,
  ExternalLink,
  Layers,
  Zap,
} from "lucide-react";
import { useAppContext } from "../../lib/context/AppContext";
import { useWorkspaceContext } from "../../lib/context/WorkspaceContext";
import { cn } from "../../lib/cn";

type TabId = "general" | "billing" | "integrations" | "security" | "notifications" | "api";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const tabs: Tab[] = [
  { id: "general", label: "General", icon: <Settings className="w-4 h-4" /> },
  { id: "billing", label: "Billing", icon: <CreditCard className="w-4 h-4" /> },
  { id: "integrations", label: "Integrations", icon: <Plug className="w-4 h-4" /> },
  { id: "security", label: "Security", icon: <Shield className="w-4 h-4" /> },
  { id: "notifications", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
  { id: "api", label: "API Keys", icon: <Key className="w-4 h-4" /> },
];

const integrations = [
  { id: "slack", name: "Slack", description: "Send alerts and notifications to Slack channels", icon: "S", connected: true },
  { id: "snowflake", name: "Snowflake", description: "Connect to Snowflake data warehouses", icon: "❄", connected: true },
  { id: "dbt", name: "dbt Cloud", description: "Sync transformations and run jobs", icon: "d", connected: false },
  { id: "airflow", name: "Apache Airflow", description: "Orchestrate ML pipelines", icon: "A", connected: false },
  { id: "datadog", name: "Datadog", description: "Monitor model performance and drift", icon: "D", connected: true },
];

const apiKeys = [
  { id: "key-1", name: "Production API Key", prefix: "kr_live_", lastUsed: "2 hours ago", scopes: ["read", "write"] },
  { id: "key-2", name: "Development Key", prefix: "kr_test_", lastUsed: "5 days ago", scopes: ["read"] },
];

function TabButton({ tab, active, onClick }: { tab: Tab; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "btn flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200",
        active ? "btn-primary" : "btn-ghost text"
      )}
    >
      {tab.icon}
      <span>{tab.label}</span>
    </button>
  );
}

function SectionCard({
  title,
  description,
  children,
  action,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="border-b border-border-subtle px-6 py-4 flex items-center justify-between surface-2">
        <div>
          <h3 className="text-base font-semibold text">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-secondary">{description}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start justify-between cursor-pointer group">
      <div className="flex-1">
        <p className="text-sm font-medium text group-hover:text-accent transition-colors">{label}</p>
        {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-accent focus:ring-offset-2",
          checked ? "bg-accent" : "bg-surface-3"
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none inline-block size-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </label>
  );
}

function ActiveTabContent({ activeTab }: { activeTab: TabId }) {
  const { datasets } = useAppContext();
  const { activeWorkspace } = useWorkspaceContext();

  const [toggles, setToggles] = useState({
    safeSql: true,
    auditLog: true,
    prodDeploy: false,
    emailNotifs: true,
    slackAlerts: true,
    weeklyDigest: true,
    modelAlerts: true,
    dataQuality: true,
  });
  const [workspaceName, setWorkspaceName] = useState(activeWorkspace?.name ?? "");
  const [workspaceSlug, setWorkspaceSlug] = useState(activeWorkspace?.slug ?? "");
  const [saved, setSaved] = useState(false);

  if (!activeWorkspace) return null;

  const handleSaveGeneral = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (activeTab === "general") {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Workspace Identity" description="Basic workspace configuration">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-secondary mb-2">Workspace Name</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
                  <input
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="input w-full pl-10 pr-4 py-2.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-secondary mb-2">Workspace Slug</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
                  <input
                    value={workspaceSlug}
                    onChange={(e) => setWorkspaceSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                    className="input w-full pl-10 pr-4 py-2.5"
                  />
                </div>
                <p className="text-xs text-tertiary mt-1.5">Used in your workspace URL</p>
              </div>
              <button onClick={handleSaveGeneral} className="btn btn-primary w-full">
                {saved ? <><Check className="w-4 h-4" /> Saved</> : "Save Changes"}
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Data Configuration" description="Default dataset and pipeline settings">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-secondary mb-2">Active Dataset</label>
                <div className="relative">
                  <Database className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
                  <select className="input w-full pl-10 pr-4 py-2.5 appearance-none">
                    <option value="">— None —</option>
                    {datasets.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-tertiary mt-1.5">Used for ML pipelines and queries</p>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-secondary mb-2">Default Region</label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
                  <select className="input w-full pl-10 pr-4 py-2.5 appearance-none">
                    <option>US East (N. Virginia)</option>
                    <option>EU West (Ireland)</option>
                    <option>Asia Pacific (Singapore)</option>
                  </select>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Workspace Statistics" description="Current usage and limits">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { icon: <Database className="w-4 h-4" />, label: "Datasets", value: datasets.length },
              { icon: <Layers className="w-4 h-4" />, label: "Pipelines", value: 12 },
              { icon: <Key className="w-4 h-4" />, label: "API Calls", value: "8.2K" },
            ].map((stat) => (
              <div key={stat.label} className="p-4 rounded-lg bg-surface-2 border border-border">
                <div className="flex items-center gap-2 text-secondary mb-2">
                  {stat.icon}
                  <span className="text-xs font-medium uppercase tracking-wider">{stat.label}</span>
                </div>
                <p className="text-2xl font-bold text">{stat.value}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    );
  }

  if (activeTab === "billing") {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <SectionCard title="Current Plan" description="Your subscription details">
              <div className="flex items-center justify-between p-4 rounded-lg bg-linear-to-r from-accent/5 to-accent/5 border border-accent/20">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg font-bold text">Pro Plan</span>
                    <span className="px-2 py-0.5 text-xs font-medium bg-accent text-white rounded-full">Active</span>
                  </div>
                  <p className="text-sm text-secondary">$49/month · Billed monthly</p>
                </div>
                <button className="btn btn-secondary">Upgrade</button>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-4">
                {[
                  { label: "Team Seats", value: "5" },
                  { label: "Storage", value: "50GB" },
                  { label: "API Calls/mo", value: "10K" },
                ].map((item) => (
                  <div key={item.label} className="text-center p-3 rounded-lg border border-border">
                    <p className="text-2xl font-bold text">{item.value}</p>
                    <p className="text-xs text-secondary">{item.label}</p>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Payment Method" description="Manage your payment options">
              <div className="flex items-center justify-between p-4 rounded-lg border border-border">
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-lg bg-surface-2 flex items-center justify-center text-lg font-bold text">💳</div>
                  <div>
                    <p className="text-sm font-medium text">Visa ending in 4242</p>
                    <p className="text-xs text-secondary">Expires 12/2026</p>
                  </div>
                </div>
                <button className="text-sm text-accent hover:underline">Update</button>
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard title="Usage This Month">
              <div className="space-y-4">
                {[
                  { label: "API Calls", used: 8234, total: 10000, pct: 82 },
                  { label: "Storage", used: "32GB", total: "50GB", pct: 64 },
                  { label: "Datasets", used: datasets.length, total: 50, pct: Math.min((datasets.length / 50) * 100, 100) },
                ].map((item) => (
                  <div key={item.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-secondary">{item.label}</span>
                      <span className="text font-medium">{item.used} / {item.total}</span>
                    </div>
                    <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full" style={{ width: `${item.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Invoice History">
              <div className="space-y-2">
                {[
                  { date: "Mar 2024", amount: "$49.00" },
                  { date: "Feb 2024", amount: "$49.00" },
                  { date: "Jan 2024", amount: "$49.00" },
                ].map((inv, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-sm hover:bg-surface-2/30 transition-colors cursor-pointer">
                    <span className="text-sm text">{inv.date}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text">{inv.amount}</span>
                      <span className="text-xs text-success">paid</span>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === "integrations") {
    return (
      <div className="space-y-6">
        <SectionCard title="Connected Integrations" description="Active connections and their status">
          <div className="grid gap-3">
            {integrations.filter((i) => i.connected).map((integration) => (
              <div key={integration.id} className="flex items-center justify-between p-4 rounded-lg border border-success/20 bg-success/5">
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-lg bg-surface-2 flex items-center justify-center text-lg font-bold">{integration.icon}</div>
                  <div>
                    <p className="text-sm font-medium text">{integration.name}</p>
                    <p className="text-xs text-secondary">{integration.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-success">
                    <span className="size-2 rounded-full bg-success animate-pulse" />
                    Connected
                  </span>
                  <button className="text-sm text-secondary hover:text transition-colors">Configure</button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Available Integrations" description="Connect more services to enhance your workspace">
          <div className="grid gap-3 md:grid-cols-2">
            {integrations.filter((i) => !i.connected).map((integration) => (
              <div key={integration.id} className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-accent/30 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-lg bg-surface-2 flex items-center justify-center text-lg font-bold text-secondary">{integration.icon}</div>
                  <div>
                    <p className="text-sm font-medium text">{integration.name}</p>
                    <p className="text-xs text-secondary">{integration.description}</p>
                  </div>
                </div>
                <button className="btn btn-secondary text-xs">Connect</button>
              </div>
            ))}
          </div>
        </SectionCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Webhooks" description="Configure outgoing webhooks">
            <div className="text-center py-8 text-secondary">
              <Zap className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No webhooks configured</p>
              <button className="mt-3 text-xs text-accent hover:underline">Add webhook</button>
            </div>
          </SectionCard>
          <SectionCard title="SSO Configuration" description="Single sign-on settings">
            <div className="text-center py-8 text-secondary">
              <Shield className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No SSO provider configured</p>
              <button className="mt-3 text-xs text-accent hover:underline">Set up SSO</button>
            </div>
          </SectionCard>
        </div>
      </div>
    );
  }

  if (activeTab === "security") {
    return (
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard title="Feature Toggles" description="Control workspace behavior">
            <div className="space-y-4">
              <Toggle label="Safe SQL Execution" description="Enable parameterized queries and query validation" checked={toggles.safeSql} onChange={(c) => setToggles({ ...toggles, safeSql: c })} />
              <Toggle label="Query Audit Logging" description="Log all queries for compliance and debugging" checked={toggles.auditLog} onChange={(c) => setToggles({ ...toggles, auditLog: c })} />
              <Toggle label="Allow Production Deployments" description="Enable deployment to production environment" checked={toggles.prodDeploy} onChange={(c) => setToggles({ ...toggles, prodDeploy: c })} />
            </div>
          </SectionCard>

          <SectionCard title="Access Control" description="Security and authentication settings">
            <div className="space-y-4">
              {[
                { icon: <Shield className="w-4 h-4" />, label: "Two-Factor Authentication", desc: "Require 2FA for all members", value: "Enabled", color: "text-success" },
                { icon: <Key className="w-4 h-4" />, label: "Session Timeout", desc: "Auto-logout after inactivity", value: "30 minutes", color: "text" },
                { icon: <Globe className="w-4 h-4" />, label: "IP Allowlist", desc: "Restrict access to specific IPs", value: "Not configured", color: "text-secondary" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-accent/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg bg-surface-2 flex items-center justify-center">{item.icon}</div>
                    <div>
                      <p className="text-sm font-medium text">{item.label}</p>
                      <p className="text-xs text-secondary">{item.desc}</p>
                    </div>
                  </div>
                  <span className={cn("text-xs font-medium", item.color)}>{item.value}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Security Audit Log" description="Recent security events">
          <div className="space-y-2">
            {[
              { event: "Login from new device", time: "2 hours ago", status: "success" },
              { event: "API key created", time: "1 day ago", status: "info" },
              { event: "Settings modified", time: "1 week ago", status: "warning" },
            ].map((log, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className="flex items-center gap-3">
                  <AlertCircle className={cn("w-4 h-4", log.status === "success" ? "text-success" : log.status === "warning" ? "text-warning" : "text-secondary")} />
                  <span className="text-sm text">{log.event}</span>
                </div>
                <span className="text-xs text-secondary">{log.time}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    );
  }

  if (activeTab === "notifications") {
    return (
      <div className="space-y-6">
        <SectionCard title="Notification Channels" description="Where you receive alerts">
          <div className="space-y-4">
            <Toggle label="Email Notifications" description="Receive important updates via email" checked={toggles.emailNotifs} onChange={(c) => setToggles({ ...toggles, emailNotifs: c })} />
            <Toggle label="Slack Alerts" description="Send alerts to connected Slack workspace" checked={toggles.slackAlerts} onChange={(c) => setToggles({ ...toggles, slackAlerts: c })} />
          </div>
        </SectionCard>

        <SectionCard title="Notification Preferences" description="Choose what to be notified about">
          <div className="space-y-4">
            <Toggle label="Weekly Digest" description="Summary of workspace activity every Monday" checked={toggles.weeklyDigest} onChange={(c) => setToggles({ ...toggles, weeklyDigest: c })} />
            <Toggle label="Model Alerts" description="Notify when models complete or fail" checked={toggles.modelAlerts} onChange={(c) => setToggles({ ...toggles, modelAlerts: c })} />
            <Toggle label="Data Quality Issues" description="Alert when dataset quality drops below threshold" checked={toggles.dataQuality} onChange={(c) => setToggles({ ...toggles, dataQuality: c })} />
          </div>
        </SectionCard>
      </div>
    );
  }

  if (activeTab === "api") {
    return (
      <div className="space-y-6">
        <SectionCard
          title="API Keys"
          description="Manage API keys for programmatic access"
          action={
            <button className="btn btn-primary">
              <Key className="w-4 h-4" />
              Create Key
            </button>
          }
        >
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div key={key.id} className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-accent/30 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-lg bg-surface-2 flex items-center justify-center">
                    <Key className="w-4 h-4 text-secondary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text">{key.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-surface-2 px-2 py-0.5 rounded-sm text-secondary font-mono">{key.prefix}••••••••</code>
                      <button className="text-xs text-accent hover:underline flex items-center gap-1">
                        <Copy className="w-3 h-3" /> Copy
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-secondary">Last used {key.lastUsed}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {key.scopes.map((scope) => (
                      <span key={scope} className="px-2 py-0.5 text-xs bg-surface-2 text-secondary rounded-sm">{scope}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="API Documentation" description="Learn how to use the API">
          <div className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-accent/30 transition-colors cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="size-10 rounded-lg bg-surface-2 flex items-center justify-center">
                <ExternalLink className="w-4 h-4 text-secondary" />
              </div>
              <div>
                <p className="text-sm font-medium text">API Reference</p>
                <p className="text-xs text-secondary">Full documentation with examples</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-secondary" />
          </div>
        </SectionCard>
      </div>
    );
  }

  return null;
}

export function WorkspaceSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const { activeWorkspace } = useWorkspaceContext();

  if (!activeWorkspace) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text">{activeWorkspace.name}</h1>
          <p className="text-sm text-secondary mt-1">
            {activeWorkspace.description ?? "Manage workspace configuration and integrations."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full border bg-accent/10 text-accent border-accent/20">
            Owner
          </span>
          <span className="text-xs text-secondary font-mono">{activeWorkspace.slug}</span>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {tabs.map((tab) => (
          <TabButton key={tab.id} tab={tab} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)} />
        ))}
      </div>

      <div className="min-h-[400px]">
        <ActiveTabContent activeTab={activeTab} />
      </div>
    </div>
  );
}
