import { Link } from "react-router-dom";
import { PageHeader } from "../../components/shared/PageHeader";
import { useAppContext } from "../../lib/context/AppContext";
import { cn } from "../../lib/cn";

export function HomePage() {
  const { datasets } = useAppContext();

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-700">
      <PageHeader
        title="Project Intelligence Home"
        subtitle="Centralized command for your data pipelines and predictive model lifecycle."
        actions={
          <div className="flex gap-3">
            <Link to="/app/data-import" className="btn btn-secondary text-xs px-4">Ingest Data</Link>
            <Link to="/app/automl-lab" className="btn btn-primary text-xs px-4 shadow-xl shadow-primary/10">Launch Neural Search</Link>
          </div>
        }
      />

      <div className="p-8 pt-0 space-y-8">
        {/* Rapid Status Bar */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { label: "Total Vectors", value: datasets.reduce((acc, d) => acc + d.rows, 0).toLocaleString(), trend: "+12%", color: "text" },
            { label: "Compute Health", value: "99.98%", trend: "STABLE", color: "text-success" },
            { label: "Active Pipelines", value: "14", trend: "+2", color: "text" },
            { label: "Predictive Nodes", value: "3", trend: "ONLINE", color: "text-accent" },
          ].map((m, i) => (
            <div key={i} className="card p-5 group hover:shadow-2xl hover:shadow-primary/5 transition-all">
              <p className="text-[10px] font-black uppercase tracking-widest text-text-tertiary mb-1">{m.label}</p>
              <div className="flex items-end justify-between">
                <p className={cn("text-3xl font-black tracking-tighter tabular-nums", m.color)}>{m.value}</p>
                {m.trend === "STABLE" || m.trend === "ONLINE" ? (
                  <span className="text-[9px] font-black text-success border border-success/20 bg-success/5 px-2 py-0.5 rounded-sm flex items-center gap-1">
                    <span className="size-1 bg-success rounded-full animate-pulse" />
                    {m.trend}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-success bg-success/5 px-2 py-1 rounded-full">{m.trend}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Core Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Section 1: Data Pulse */}
          <div className="card lg:col-span-2 p-8 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold tracking-tight">Analytical Data Fabric</h3>
                <p className="text-sm text-text-tertiary">Real-time monitoring of imported and transformed entities.</p>
              </div>
              <Link to="/app/data-import" className="text-xs font-bold text-primary hover:underline uppercase tracking-widest">Expansion Protocol</Link>
            </div>
            <div className="space-y-3">
              {datasets.slice(0, 4).map(ds => (
                <div key={ds.id} className="group p-4 rounded-2xl border border-border-subtle bg-surface-2/30 hover:bg-surface hover:border-primary/20 transition-all flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="size-10 rounded-xl bg-surface-2 border border-border flex items-center justify-center font-bold text-xs text-text-tertiary group-hover:bg-primary group-hover:text-white transition-all">
                      {ds.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-sm">{ds.name}</p>
                      <p className="text-[10px] text-text-tertiary font-bold tracking-widest uppercase">{ds.rows.toLocaleString()} Rows • Quality: {ds.qualityScore}%</p>
                    </div>
                  </div>
                  <div className="flex gap-4 items-center">
                    <div className="h-1 w-16 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full bg-success" style={{ width: `${ds.qualityScore}%` }} />
                    </div>
                    <Link to="/app/query-studio" className="p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg className="w-4 h-4 text-text-tertiary hover:text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7-7 7" /></svg>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Model Performance */}
          <div className="card p-8 bg-primary text-white space-y-8 shadow-2xl shadow-primary/20">
            <div className="space-y-2">
              <h3 className="text-xl font-bold tracking-tight text-white/90">Champion Model</h3>
              <p className="text-xs text-white/40 leading-relaxed uppercase tracking-widest font-bold">XGBoost Ensemble v4.2.1</p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-end border-b border-white/10 pb-4">
                <p className="text-6xl font-black tracking-tighter">94.8%</p>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Validation Score</p>
                  <p className="text-xs font-bold text-success">+1.2% Drift</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Inference Latency</p>
                  <p className="text-lg font-black mt-1">12.4ms</p>
                </div>
                <div className="p-4 rounded-xl bg-white/5 border border-white/10">
                  <p className="text-[9px] font-bold text-white/40 uppercase tracking-widest">Memory Footprint</p>
                  <p className="text-lg font-black mt-1">4.2 GB</p>
                </div>
              </div>
            </div>

            <div className="pt-4 space-y-4">
              <button className="w-full py-3 rounded-xl bg-white text-primary font-bold text-sm shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all">Optimize Architecture</button>
              <Link to="/app/ml-prediction" className="block text-center text-xs font-bold text-white/60 hover:text-white transition-colors uppercase tracking-widest">Inference Sandbox</Link>
            </div>
          </div>

        </div>

        {/* Section 3: Rapid Access Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-12">
          {[
            { title: "Query Studio", desc: "Natural language datasets interrogation.", url: "/app/query-studio", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
            { title: "Pipeline Manager", desc: "Automate complex data transformations.", url: "/app/data-transform", icon: "M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.675.337a4 4 0 01-2.574.345l-2.313-.463c-.574-.115-1.155.032-1.536.413l-1.119 1.119a2 2 0 01-2.828 0l-3.536-3.536a2 2 0 010-2.828l1.119-1.119a2 2 0 00.413-1.536L4.057 6.42a4 4 0 01.345-2.574l.338-.675a6 6 0 00.517-3.861L4.78 1.056a2 2 0 00-.547-1.022L2.73 2.73a2 2 0 000 2.828l3.536 3.536a2 2 0 002.828 0L9.11 9.11a2 2 0 011.536-.413l2.313.463a4 4 0 002.574-.345l.675-.338a6 6 0 013.861-.517l2.387.477a2 2 0 011.022.547l1.503 1.503z" },
            { title: "Metric Lab", desc: "Visual dashboarding for KPI monitoring.", url: "/app/eda-dashboards", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" }
          ].map(item => (
            <Link key={item.title} to={item.url} className="card p-6 flex items-start gap-4 hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/5 transition-all group">
              <div className="p-3 rounded-2xl bg-surface-2 text-text-tertiary group-hover:bg-primary group-hover:text-white transition-all">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} /></svg>
              </div>
              <div>
                <h4 className="font-bold tracking-tight">{item.title}</h4>
                <p className="text-xs text-text-tertiary mt-1 leading-relaxed">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>

      </div>
    </div>
  );
}