import { useState, useRef, useEffect, useCallback } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { LoaderCircle } from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { PreviewNotice } from "../../components/shared/PreviewNotice";
import { cn } from "../../lib/cn";
import { formatBytes, formatCount, formatDate, formatDateTime } from "../../lib/format";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface ModelInfo {
  id: string;
  name: string;
  algorithm: string;
  accuracy: number;
  features: string[];
  createdAt: string; // ISO date
  version: string;
}

interface Contribution {
  feature: string;
  importance: number;
  direction: "+" | "−";
}

interface PredictionResult {
  value: "Positive" | "Negative";
  confidence: number;
  probabilities: { label: string; prob: number }[];
  contributions: Contribution[];
}

interface BatchResult {
  total: number;
  positive: number;
  negative: number;
  avgConfidence: number;
  processedAt: string;
}

interface HistoryItem {
  id: string;
  model: string;
  input: string;
  result: PredictionResult["value"];
  confidence: number;
  at: string; // ISO timestamp
}

type PredictionTab = "playground" | "batch" | "history";

/* ------------------------------------------------------------------ */
/*  Sample data (no model backend yet)                                 */
/* ------------------------------------------------------------------ */
const sampleModels: ModelInfo[] = [
  {
    id: "m-1", name: "Customer churn", algorithm: "XGBoost", accuracy: 0.948,
    features: ["age", "income", "education", "employment", "balance", "transactions"],
    createdAt: "2026-03-15", version: "2.1.0",
  },
  {
    id: "m-2", name: "Fraud detection", algorithm: "Random Forest", accuracy: 0.923,
    features: ["age", "income", "education", "employment", "balance", "transactions"],
    createdAt: "2026-03-10", version: "1.3.0",
  },
  {
    id: "m-3", name: "Credit scoring", algorithm: "Logistic Regression", accuracy: 0.861,
    features: ["age", "income", "balance", "transactions"],
    createdAt: "2026-02-28", version: "1.0.0",
  },
];

const featureDefinitions = [
  { name: "age", label: "Age", type: "number" as const, placeholder: "e.g. 35" },
  { name: "income", label: "Annual income (SGD)", type: "number" as const, placeholder: "e.g. 50000" },
  { name: "education", label: "Education level", type: "select" as const, options: ["High School", "Bachelor", "Master", "PhD"] },
  { name: "employment", label: "Employment status", type: "select" as const, options: ["Employed", "Self-employed", "Unemployed", "Retired"] },
  { name: "balance", label: "Account balance (SGD)", type: "number" as const, placeholder: "e.g. 10000" },
  { name: "transactions", label: "Monthly transactions", type: "number" as const, placeholder: "e.g. 15" },
];

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const UPLOAD_EXTENSIONS = [".csv", ".jsonl", ".parquet"];

/* ------------------------------------------------------------------ */
/*  Deterministic simulation: same inputs always give the same output  */
/* ------------------------------------------------------------------ */
/** FNV-1a string hash mapped to [0, 1). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function simulatePrediction(model: ModelInfo, inputs: Record<string, string>): PredictionResult {
  const key = model.id + model.features.map((f) => `|${f}=${inputs[f] ?? ""}`).join("");
  const positive = 0.1 + 0.8 * hash01(key);
  const value = positive >= 0.5 ? "Positive" : "Negative";
  const confidence = Math.max(positive, 1 - positive);

  const raw = model.features.map((f) => ({ feature: f, w: 0.1 + hash01(`${key}:${f}`) }));
  const total = raw.reduce((sum, r) => sum + r.w, 0);
  const contributions: Contribution[] = raw
    .map((r) => ({
      feature: featureDefinitions.find((d) => d.name === r.feature)?.label.replace(/ \(SGD\)$/, "") ?? r.feature,
      importance: r.w / total,
      direction: hash01(`${key}:${r.feature}:dir`) >= 0.5 ? ("+" as const) : ("−" as const),
    }))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 4);

  return {
    value,
    confidence,
    probabilities: [
      { label: "Positive", prob: positive },
      { label: "Negative", prob: 1 - positive },
    ],
    contributions,
  };
}

function simulateBatch(model: ModelInfo, file: File): BatchResult {
  const key = `${model.id}:${file.name}:${file.size}`;
  const total = 500 + Math.floor(hash01(`${key}:n`) * 4500);
  const positive = Math.round(total * (0.35 + 0.3 * hash01(`${key}:p`)));
  return {
    total,
    positive,
    negative: total - positive,
    avgConfidence: 0.75 + 0.15 * hash01(`${key}:c`),
    processedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Small pieces                                                       */
/* ------------------------------------------------------------------ */
function SimulatedBadge() {
  return <span className="badge bg-surface-2 text-text-secondary">Simulated</span>;
}

function ModelCard({ model, isSelected, onSelect }: {
  model: ModelInfo; isSelected: boolean; onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "w-full rounded-md px-2.5 py-2 text-left transition-colors",
        isSelected ? "bg-primary-muted" : "hover:bg-surface-2",
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className={cn("truncate text-[13px] font-medium", isSelected ? "text-primary" : "text-text")}>{model.name}</span>
        <span className="tabular shrink-0 font-mono text-xs text-text-secondary">{(model.accuracy * 100).toFixed(1)}%</span>
      </span>
      <span className="block text-xs text-text-tertiary">{model.algorithm} · v{model.version}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Playground Tab                                                     */
/* ------------------------------------------------------------------ */
function PlaygroundTab({
  model, onPredict, isPredicting, result,
}: {
  model: ModelInfo;
  onPredict: (inputs: Record<string, string>) => void;
  isPredicting: boolean;
  result: PredictionResult | null;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const features = featureDefinitions.filter((f) => model.features.includes(f.name));
  const isValid = features.every((f) => inputs[f.name]);

  const fillSample = () => {
    setInputs({
      age: "35", income: "52000", education: "Bachelor", employment: "Employed", balance: "12400", transactions: "15",
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text">Input features</h3>
          <button onClick={fillSample} className="btn btn-ghost btn-sm">Fill sample</button>
        </div>
        <div className="space-y-3">
          {features.map((feature) => (
            <div key={feature.name}>
              <label htmlFor={`pred-${feature.name}`} className="field-label">{feature.label}</label>
              {feature.type === "select" ? (
                <select id={`pred-${feature.name}`} value={inputs[feature.name] ?? ""}
                  onChange={(e) => setInputs({ ...inputs, [feature.name]: e.target.value })} className="input">
                  <option value="">Select…</option>
                  {feature.options.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                </select>
              ) : (
                <input id={`pred-${feature.name}`} type="number" placeholder={feature.placeholder} value={inputs[feature.name] ?? ""}
                  onChange={(e) => setInputs({ ...inputs, [feature.name]: e.target.value })} className="input" />
              )}
            </div>
          ))}
        </div>
        <button onClick={() => onPredict(inputs)} disabled={isPredicting || !isValid} className="btn btn-primary w-full">
          {isPredicting ? <><LoaderCircle size={15} className="animate-spin" /> Predicting…</> : "Run prediction"}
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-text">Result</h3>
          <SimulatedBadge />
        </div>
        {!result && !isPredicting && (
          <div className="rounded-md bg-surface-2 px-4 py-8 text-center">
            <p className="text-[13px] text-text-secondary">No prediction yet</p>
            <p className="mt-0.5 text-xs text-text-tertiary">Fill in the features and run a prediction.</p>
          </div>
        )}
        {isPredicting && (
          <div role="status" className="flex items-center justify-center gap-2 rounded-md bg-surface-2 px-4 py-8 text-[13px] text-text-secondary">
            <LoaderCircle size={15} className="animate-spin text-text-tertiary" />
            <p>Running simulated prediction…</p>
          </div>
        )}
        {result && !isPredicting && (
          <div className="divide-y divide-border-subtle">
            <div className="flex items-end justify-between gap-4 pb-4">
              <div>
                <p className="section-label">Prediction</p>
                <p className={cn("mt-0.5 text-lg font-semibold", result.value === "Positive" ? "text-success" : "text-danger")}>
                  {result.value}
                </p>
              </div>
              <p className="text-right">
                <span className="tabular block font-mono text-lg font-semibold text-text">{(result.confidence * 100).toFixed(0)}%</span>
                <span className="section-label">Confidence</span>
              </p>
            </div>

            <div className="space-y-2.5 py-4">
              <p className="section-label">Class probabilities</p>
              {result.probabilities.map((p) => (
                <div key={p.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn("font-medium", p.label === result.value ? "text-text" : "text-text-tertiary")}>{p.label}</span>
                    <span className="font-mono text-text">{(p.prob * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${p.prob * 100}%`, opacity: p.label === result.value ? 1 : 0.3 }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2.5 pt-4">
              <p className="section-label">Feature contributions (simulated)</p>
              {result.contributions.map((f) => (
                <div key={f.feature} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 truncate text-text-secondary">{f.feature}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${f.importance * 100}%` }} />
                  </div>
                  <span className="w-10 text-right font-mono text-text-secondary">{f.direction}{(f.importance * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Batch Tab                                                          */
/* ------------------------------------------------------------------ */
function BatchTab({ model }: { model: ModelInfo }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [progress, setProgress] = useState(0);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    if (!UPLOAD_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext))) {
      setError("Unsupported file type. Use a CSV, JSONL or Parquet file.");
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${formatBytes(f.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setError(null);
    setFile(f);
    setBatchResult(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    acceptFile(e.dataTransfer.files[0]);
  };

  const handleProcess = () => {
    if (!file) return;
    stopTimer();
    setIsProcessing(true);
    setProgress(0);
    setBatchResult(null);
    let pct = 0;
    timer.current = window.setInterval(() => {
      pct += 12;
      if (pct >= 100) {
        stopTimer();
        setProgress(100);
        setIsProcessing(false);
        setBatchResult(simulateBatch(model, file));
      } else {
        setProgress(pct);
      }
    }, 300);
  };

  const reset = () => {
    stopTimer();
    setFile(null);
    setBatchResult(null);
    setIsProcessing(false);
    setProgress(0);
  };

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-8 text-center transition-colors",
          isDragging ? "border-primary bg-primary-muted" : file ? "border-border bg-surface-2" : "border-border",
        )}
      >
        <input ref={fileInputRef} type="file" accept={UPLOAD_EXTENSIONS.join(",")} className="hidden"
          onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ""; }} />
        {file ? (
          <>
            <p className="text-sm font-medium text-text">{file.name}</p>
            <p className="mt-0.5 text-xs text-text-tertiary">{formatBytes(file.size)} · Ready to process</p>
            <button onClick={reset} disabled={isProcessing} className="btn btn-ghost btn-sm mt-2">Change file</button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-text">Drop a file here, or browse</p>
            <p className="mt-0.5 text-xs text-text-tertiary">CSV, JSONL or Parquet, up to {formatBytes(MAX_UPLOAD_BYTES)}. The file stays in your browser.</p>
            <button onClick={() => fileInputRef.current?.click()} className="btn btn-secondary btn-sm mt-3">Browse files</button>
          </>
        )}
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}

      {file && !batchResult && (
        <button onClick={handleProcess} disabled={isProcessing} className="btn btn-primary w-full">
          {isProcessing ? `Processing… ${progress.toFixed(0)}%` : "Run simulated batch"}
        </button>
      )}

      {isProcessing && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar"
          aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      {batchResult && (
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text">Batch summary</h3>
            <SimulatedBadge />
          </div>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Generated {formatDateTime(batchResult.processedAt)}. Counts are made up for this preview, not read from your file.
          </p>
          <dl className="mt-3 grid grid-cols-2 divide-border-subtle rounded-md border border-border sm:grid-cols-4 sm:divide-x">
            {[
              { label: "Total rows", value: formatCount(batchResult.total) },
              { label: "Positive", value: formatCount(batchResult.positive) },
              { label: "Negative", value: formatCount(batchResult.negative) },
              { label: "Avg confidence", value: `${(batchResult.avgConfidence * 100).toFixed(1)}%` },
            ].map((s) => (
              <div key={s.label} className="px-3 py-2.5">
                <dt className="text-xs text-text-tertiary">{s.label}</dt>
                <dd className="tabular mt-0.5 font-mono text-[15px] font-semibold text-text">{s.value}</dd>
              </div>
            ))}
          </dl>
          <button onClick={reset} className="btn btn-secondary btn-sm mt-4">Start over</button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History Tab (this session only)                                    */
/* ------------------------------------------------------------------ */
function HistoryTab({ items, onClear }: { items: HistoryItem[]; onClear: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="section-label">Predictions this session</p>
        {items.length > 0 && <button onClick={onClear} className="btn btn-ghost btn-sm">Clear</button>}
      </div>
      {items.length === 0 ? (
        <div className="rounded-md bg-surface-2 px-4 py-8 text-center">
          <p className="text-[13px] text-text-secondary">Nothing here yet</p>
          <p className="mt-0.5 text-xs text-text-tertiary">Simulated predictions from the Playground tab appear here until you leave the page.</p>
        </div>
      ) : (
        <div className="divide-y divide-border-subtle rounded-md border border-border">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text">{item.model}</p>
                <p className="truncate font-mono text-xs text-text-tertiary">{item.input}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className={cn("text-[13px] font-medium", item.result === "Positive" ? "text-success" : "text-danger")}>
                  {item.result} ({(item.confidence * 100).toFixed(0)}%)
                </p>
                <p className="text-xs text-text-tertiary">{formatDateTime(item.at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */
const TABS: { key: PredictionTab; label: string }[] = [
  { key: "playground", label: "Playground" },
  { key: "batch", label: "Batch" },
  { key: "history", label: "History" },
];

export function MLPredictionPage() {
  const navigate = useNavigate();
  const [selectedModelId, setSelectedModelId] = useState(sampleModels[0].id);
  const [activeTab, setActiveTab] = useState<PredictionTab>("playground");
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const predictTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (predictTimer.current !== null) window.clearTimeout(predictTimer.current);
  }, []);

  const selectedModel = sampleModels.find((m) => m.id === selectedModelId) ?? sampleModels[0];

  const selectModel = (id: string) => {
    if (predictTimer.current !== null) window.clearTimeout(predictTimer.current);
    setIsPredicting(false);
    setSelectedModelId(id);
    setPredictionResult(null);
  };

  const handlePredict = (inputs: Record<string, string>) => {
    const model = selectedModel;
    setIsPredicting(true);
    setPredictionResult(null);
    predictTimer.current = window.setTimeout(() => {
      predictTimer.current = null;
      const result = simulatePrediction(model, inputs);
      setPredictionResult(result);
      setIsPredicting(false);
      setHistory((prev) => [{
        id: `p-${Date.now()}`,
        model: model.name,
        input: model.features.slice(0, 3).map((f) => `${f}=${inputs[f]}`).join(", "),
        result: result.value,
        confidence: result.confidence,
        at: new Date().toISOString(),
      }, ...prev]);
    }, 800);
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.key === activeTab);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const key = TABS[(next + TABS.length) % TABS.length].key;
    setActiveTab(key);
    document.getElementById(`pred-tab-${key}`)?.focus();
  };

  return (
    <section>
      <PageHeader
        title="Predictions"
        subtitle="Try a model on a single record or a file of records."
        actions={<button onClick={() => navigate("/app/ml-training")} className="btn btn-secondary">Train a model</button>}
      />
      <PreviewNotice>
        The models, predictions and batch results on this page are simulated. The same inputs always give the same output, but nothing is scored by a real model.
      </PreviewNotice>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="h-fit divide-y divide-border rounded-lg border border-border bg-surface">
          <div className="space-y-1.5 p-2">
            <div className="flex items-center justify-between px-1 pt-1">
              <p className="section-label">Sample models</p>
              <SimulatedBadge />
            </div>
            <div className="space-y-0.5">
              {sampleModels.map((model) => (
                <ModelCard key={model.id} model={model} isSelected={selectedModelId === model.id}
                  onSelect={() => selectModel(model.id)} />
              ))}
            </div>
          </div>

          <div className="space-y-2 p-3">
            <p className="section-label">Details</p>
            <div className="space-y-1.5 text-xs">
              {[
                { label: "Algorithm", value: selectedModel.algorithm },
                { label: "Version", value: `v${selectedModel.version}` },
                { label: "Created", value: formatDate(selectedModel.createdAt) },
                { label: "Features", value: `${selectedModel.features.length} inputs` },
              ].map((item) => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-text-tertiary">{item.label}</span>
                  <span className="font-medium text-text">{item.value}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border-subtle pt-2">
              <p className="section-label mb-1.5">Features</p>
              <div className="flex flex-wrap gap-1">
                {selectedModel.features.map((f) => (
                  <span key={f} className="badge bg-surface-2 font-mono font-normal text-text-secondary">{f}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-border bg-surface">
          <div className="border-b border-border px-3">
            <div role="tablist" aria-label="Prediction modes" className="-mb-px flex gap-4">
              {TABS.map((tab) => (
                <button key={tab.key} role="tab" id={`pred-tab-${tab.key}`}
                  aria-selected={activeTab === tab.key} aria-controls={`pred-panel-${tab.key}`}
                  tabIndex={activeTab === tab.key ? 0 : -1}
                  onClick={() => setActiveTab(tab.key)} onKeyDown={onTabKeyDown}
                  className={cn("border-b-2 px-0.5 py-2.5 text-[13px] font-medium transition-colors",
                    activeTab === tab.key ? "border-primary text-text" : "border-transparent text-text-tertiary hover:text-text-secondary")}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-5" role="tabpanel" id={`pred-panel-${activeTab}`} aria-labelledby={`pred-tab-${activeTab}`}>
            {activeTab === "playground" && (
              <PlaygroundTab model={selectedModel} onPredict={handlePredict} isPredicting={isPredicting} result={predictionResult} />
            )}
            {activeTab === "batch" && <BatchTab key={selectedModel.id} model={selectedModel} />}
            {activeTab === "history" && <HistoryTab items={history} onClear={() => setHistory([])} />}
          </div>
        </div>
      </div>
    </section>
  );
}
