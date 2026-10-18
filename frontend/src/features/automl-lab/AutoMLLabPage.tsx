import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
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
        <div role="status" className="flex items-center gap-2 py-10 text-[13px] text-text-tertiary">
          <LoaderCircle size={15} className="animate-spin" /> Loading datasets…
        </div>
      ) : datasets.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-10 text-center">
          <h2 className="text-base font-semibold text-text">No datasets yet</h2>
          <p className="mt-1 text-[13px] text-text-secondary">Import a dataset first, then come back to compare models on it.</p>
          <Link to="/app/data-import" className="btn btn-primary mt-4">Go to data sources</Link>
        </div>
      ) : isRunning ? (
        <div role="status" className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-4">
          <LoaderCircle size={16} className="shrink-0 animate-spin text-text-tertiary" />
          <div>
            <p className="text-[13px] font-medium text-text">Comparing candidate models…</p>
            <p className="text-xs text-text-secondary">Simulated run on “{dataset?.name}”. This takes a few seconds.</p>
          </div>
        </div>
      ) : results ? (
        <section aria-labelledby="automl-results">
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="automl-results" className="flex items-center gap-2 text-sm font-semibold text-text">
                Candidate models <span className="badge bg-surface-2 text-text-secondary">Simulated</span>
              </h2>
              <p className="text-xs text-text-secondary">Sample ranking for “{dataset?.name}”. These scores aren't measured.</p>
            </div>
            <button onClick={() => setResults(null)} className="btn btn-secondary btn-sm">Start over</button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-tertiary">
                  <th scope="col" className="w-14 px-4 py-2 text-right font-medium">Rank</th>
                  <th scope="col" className="px-3 py-2 font-medium">Model</th>
                  <th scope="col" className="px-3 py-2 font-medium">Complexity</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Sample score</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.id} className="table-row last:border-0">
                    <td className="tabular px-4 py-2 text-right font-mono text-text-tertiary">{r.id}</td>
                    <td className="px-3 py-2 font-medium text-text">{r.name}</td>
                    <td className="px-3 py-2 text-text-secondary">{r.complexity}</td>
                    <td className="tabular px-4 py-2 text-right font-mono">{r.score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section aria-labelledby="automl-setup" className="max-w-lg rounded-lg border border-border bg-surface p-5">
          <h2 id="automl-setup" className="text-sm font-semibold text-text">Compare models on a dataset</h2>
          <p className="mt-0.5 text-[13px] text-text-secondary">Pick a dataset and run a simulated comparison.</p>

          <div className="mt-4">
            <label htmlFor="automl-dataset" className="field-label">Dataset</label>
            <select id="automl-dataset" className="input" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}>
              <option value="">Choose a dataset…</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>{d.name} · {formatCount(d.latest_row_count)} rows</option>
              ))}
            </select>
          </div>

          <button onClick={run} disabled={!dataset} className="btn btn-primary mt-4">Run comparison</button>
        </section>
      )}
    </div>
  );
}
