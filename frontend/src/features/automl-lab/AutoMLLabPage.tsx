import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LoaderCircle, Sparkles } from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { PreviewNotice } from "../../components/shared/PreviewNotice";
import { useDatasets } from "../../lib/hooks/useDatasets";
import { formatCount } from "../../lib/format";

interface Candidate {
  id: number;
  name: string;
  score: number;
  complexity: "High" | "Medium" | "Low";
}

// Sample output: nothing is trained, so the same list is shown for every dataset.
const SAMPLE_CANDIDATES: Candidate[] = [
  { id: 1, name: "Gradient boosted trees", score: 0.942, complexity: "High" },
  { id: 2, name: "Random forest", score: 0.915, complexity: "Medium" },
  { id: 3, name: "Linear ensemble", score: 0.884, complexity: "Low" },
];

export function AutoMLLabPage() {
  const { datasets, loading } = useDatasets();
  const [datasetId, setDatasetId] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<Candidate[] | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const dataset = datasets.find((d) => d.id === datasetId);

  const run = () => {
    if (!dataset) return;
    setIsRunning(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setResults(SAMPLE_CANDIDATES);
      setIsRunning(false);
    }, 2500);
  };

  return (
    <div>
      <PageHeader
        title="AutoML Lab"
        subtitle="Compare candidate models on a dataset and see which one scores best."
      />
      <PreviewNotice />

      {loading ? (
        <div className="card flex items-center justify-center gap-2 p-12 text-sm text-text-secondary">
          <LoaderCircle size={16} className="animate-spin" /> Loading datasets…
        </div>
      ) : datasets.length === 0 ? (
        <div className="card mx-auto max-w-xl p-10 text-center">
          <h2 className="text-base font-semibold text-text">No datasets yet</h2>
          <p className="mt-1 text-sm text-text-secondary">Import a dataset first, then come back to compare models on it.</p>
          <Link to="/app/data-import" className="btn btn-primary mt-4">Go to data sources</Link>
        </div>
      ) : isRunning ? (
        <div className="card flex flex-col items-center p-12 text-center">
          <LoaderCircle size={36} className="animate-spin text-primary" />
          <h2 className="mt-4 text-lg font-semibold text-text">Comparing candidate models…</h2>
          <p className="mt-1 text-sm text-text-secondary">Simulated run on “{dataset?.name}”. This takes a few seconds.</p>
        </div>
      ) : results ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-text">
                Candidate models <span className="badge ml-2 bg-signal-muted text-signal">Simulated</span>
              </h2>
              <p className="text-sm text-text-secondary">Sample ranking for “{dataset?.name}”. These scores aren't measured.</p>
            </div>
            <button onClick={() => setResults(null)} className="btn btn-secondary btn-sm">Start over</button>
          </div>

          <div className="grid gap-3">
            {results.map((r) => (
              <div key={r.id} className="card flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="flex items-center gap-4">
                  <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-surface-2 font-mono font-semibold text-primary">
                    {r.id}
                  </div>
                  <div>
                    <p className="font-semibold text-text">{r.name}</p>
                    <p className="text-xs text-text-tertiary">Complexity: <span className="text-text-secondary">{r.complexity}</span></p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="section-label">Sample score</p>
                  <p className="font-mono text-2xl font-semibold text-primary">{r.score.toFixed(3)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card mx-auto flex max-w-xl flex-col gap-5 p-8">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary-muted text-primary">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text">Compare models on a dataset</h2>
              <p className="text-sm text-text-secondary">Pick a dataset and run a simulated comparison.</p>
            </div>
          </div>

          <div>
            <label htmlFor="automl-dataset" className="field-label">Dataset</label>
            <select id="automl-dataset" className="input" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="">Choose a dataset…</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>{d.name} · {formatCount(d.latest_row_count)} rows</option>
              ))}
            </select>
          </div>

          <button onClick={run} disabled={!dataset} className="btn btn-primary self-start">Run comparison</button>
        </div>
      )}
    </div>
  );
}
