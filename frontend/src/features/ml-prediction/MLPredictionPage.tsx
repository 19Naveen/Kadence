import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/shared/PageHeader";
import { cn } from "../../lib/cn";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface ModelInfo {
  id: string;
  name: string;
  algorithm: string;
  accuracy: number;
  features: string[];
  createdAt: string;
  version: string;
  status: "ready" | "training" | "archived";
  latency: string;
  size: string;
}

interface PredictionResult {
  value: string;
  confidence: number;
  probabilities: { label: string; prob: number }[];
  latency: number;
}

interface BatchResult {
  total: number;
  positive: number;
  negative: number;
  avgConfidence: number;
  processedAt: string;
}

type PredictionTab = "playground" | "batch" | "api" | "history";

/* ------------------------------------------------------------------ */
/*  Mock Data                                                          */
/* ------------------------------------------------------------------ */
const mockModels: ModelInfo[] = [
  {
    id: "m-1", name: "Customer Churn v2", algorithm: "XGBoost", accuracy: 0.948,
    features: ["age", "income", "education", "employment", "balance", "transactions"],
    createdAt: "2024-03-15", version: "2.1.0", status: "ready", latency: "12ms", size: "4.2 MB",
  },
  {
    id: "m-2", name: "Fraud Detection", algorithm: "Random Forest", accuracy: 0.923,
    features: ["age", "income", "education", "employment", "balance", "transactions"],
    createdAt: "2024-03-10", version: "1.3.0", status: "ready", latency: "8ms", size: "12.1 MB",
  },
  {
    id: "m-3", name: "Credit Scoring", algorithm: "Logistic Regression", accuracy: 0.861,
    features: ["age", "income", "balance", "transactions"],
    createdAt: "2024-02-28", version: "1.0.0", status: "ready", latency: "3ms", size: "0.8 MB",
  },
];

const featureDefinitions = [
  { name: "age", label: "Age", type: "number" as const, placeholder: "e.g., 35" },
  { name: "income", label: "Annual Income", type: "number" as const, placeholder: "e.g., 50000" },
  { name: "education", label: "Education Level", type: "select" as const, options: ["High School", "Bachelor", "Master", "PhD"] },
  { name: "employment", label: "Employment Status", type: "select" as const, options: ["Employed", "Self-employed", "Unemployed", "Retired"] },
  { name: "balance", label: "Account Balance", type: "number" as const, placeholder: "e.g., 10000" },
  { name: "transactions", label: "Monthly Transactions", type: "number" as const, placeholder: "e.g., 15" },
];

const mockHistory = [
  { id: "p-1", model: "Customer Churn v2", input: "age=35, income=52000", result: "Positive", confidence: 0.92, time: "2 min ago" },
  { id: "p-2", model: "Customer Churn v2", input: "age=28, income=34000", result: "Negative", confidence: 0.87, time: "5 min ago" },
  { id: "p-3", model: "Fraud Detection", input: "age=45, income=78000", result: "Positive", confidence: 0.95, time: "12 min ago" },
  { id: "p-4", model: "Credit Scoring", input: "age=52, balance=5600", result: "Negative", confidence: 0.78, time: "1 hour ago" },
];

/* ------------------------------------------------------------------ */
/*  Confidence Gauge                                                   */
/* ------------------------------------------------------------------ */
function ConfidenceGauge({ value, size = 100 }: { value: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - value);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(0, 0%, 92%)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(0, 0%, 9%)" strokeWidth="6"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
          className="transition-all duration-700 ease-out" />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-xl font-semibold font-mono">{(value * 100).toFixed(0)}%</span>
        <span className="text-[9px] text-text-tertiary uppercase tracking-wider">Confidence</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Model Card                                                         */
/* ------------------------------------------------------------------ */
function ModelCard({ model, isSelected, onSelect }: {
  model: ModelInfo; isSelected: boolean; onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-all duration-150",
        isSelected ? "border-primary bg-primary/[0.03]" :
          model.status === "training" ? "border-border-subtle opacity-50" :
            "border-border-subtle hover:border-border"
      )}
      disabled={model.status === "training"}
    >
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[13px] font-semibold text">{model.name}</p>
        <span className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-medium",
          model.status === "ready" ? "bg-success-muted text-success" : "bg-warning-muted text-warning"
        )}>{model.status}</span>
      </div>
      <p className="text-[11px] text-text-tertiary">{model.algorithm} · v{model.version}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <span className="text-text-tertiary">Accuracy</span>
          <p className="font-mono font-medium">{(model.accuracy * 100).toFixed(1)}%</p>
        </div>
        <div>
          <span className="text-text-tertiary">Latency</span>
          <p className="font-mono font-medium">{model.latency}</p>
        </div>
        <div>
          <span className="text-text-tertiary">Size</span>
          <p className="font-mono font-medium">{model.size}</p>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Playground Tab                                                     */
/* ------------------------------------------------------------------ */
function PlaygroundTab({
  model, onPredict, isPredicting, result,
}: {
  model: ModelInfo | null;
  onPredict: (inputs: Record<string, string>) => void;
  isPredicting: boolean;
  result: PredictionResult | null;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const features = featureDefinitions.filter((f) => model?.features.includes(f.name));
  const isValid = features.every((f) => inputs[f.name] && inputs[f.name] !== "");

  const fillSample = () => {
    setInputs({
      age: "35", income: "52000", education: "Bachelor", employment: "Employed", balance: "12400", transactions: "15",
    });
  };

  if (!model) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h3 className="text-sm font-semibold text">Select a Model</h3>
        <p className="mt-1 text-xs text-text-tertiary">Choose a model from the sidebar to start.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Input */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text">Input Features</h3>
          <button onClick={fillSample} className="text-xs text-text-tertiary hover:text-text transition-colors">Fill sample</button>
        </div>
        <div className="space-y-2.5">
          {features.map((feature) => (
            <div key={feature.name} className="space-y-1">
              <label className="text-xs font-medium text-text-secondary">{feature.label}</label>
              {feature.type === "select" ? (
                <select value={inputs[feature.name] || ""} onChange={(e) => setInputs({ ...inputs, [feature.name]: e.target.value })} className="input text-sm">
                  <option value="">Select…</option>
                  {feature.options?.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                </select>
              ) : (
                <input type="number" placeholder={feature.placeholder} value={inputs[feature.name] || ""}
                  onChange={(e) => setInputs({ ...inputs, [feature.name]: e.target.value })} className="input text-sm" />
              )}
            </div>
          ))}
        </div>
        <button onClick={() => onPredict(inputs)} disabled={isPredicting || !isValid}
          className={cn("btn w-full py-2.5 text-sm font-medium",
            isPredicting ? "bg-primary/50 text-white" : isValid ? "btn-primary" : "bg-surface-3 text-text-tertiary cursor-not-allowed"
          )}>
          {isPredicting ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Predicting…
            </span>
          ) : "Run Prediction"}
        </button>
      </div>

      {/* Result */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text">Result</h3>
        {!result && !isPredicting && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-border-subtle p-10 text-center">
            <p className="text-sm text-text-secondary">No prediction yet</p>
            <p className="mt-0.5 text-xs text-text-tertiary">Fill in features and run prediction</p>
          </div>
        )}
        {isPredicting && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-border-subtle p-10 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mb-3" />
            <p className="text-sm text-text-secondary">Running inference…</p>
          </div>
        )}
        {result && !isPredicting && (
          <div className="space-y-3 animate-in fade-in duration-300">
            <div className={cn(
              "rounded-lg border p-5",
              result.value === "Positive" ? "border-success/30 bg-success-muted/40" : "border-danger/30 bg-danger-muted/40"
            )}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Prediction</p>
                  <p className={cn("mt-1 text-2xl font-semibold",
                    result.value === "Positive" ? "text-success" : "text-danger"
                  )}>{result.value}</p>
                  <p className="mt-1 text-xs text-text-tertiary">{result.latency}ms inference</p>
                </div>
                <ConfidenceGauge value={result.confidence} />
              </div>
            </div>

            <div className="rounded-lg border border-border-subtle p-4 space-y-2.5">
              <p className="section-label">Class Probabilities</p>
              {result.probabilities.map((p) => (
                <div key={p.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className={cn("font-medium", p.label === result.value ? "text-text" : "text-text-tertiary")}>{p.label}</span>
                    <span className="font-mono">{(p.prob * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${p.prob * 100}%`, opacity: p.label === result.value ? 1 : 0.3 }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border-subtle p-4 space-y-2.5">
              <p className="section-label">Feature Contributions</p>
              {[
                { feature: "Income", importance: 0.32, direction: "+" },
                { feature: "Balance", importance: 0.24, direction: "+" },
                { feature: "Age", importance: 0.18, direction: "−" },
                { feature: "Transactions", importance: 0.15, direction: "+" },
              ].map((f) => (
                <div key={f.feature} className="flex items-center gap-3 text-xs">
                  <span className="w-20 text-text-secondary">{f.feature}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${f.importance * 100}%` }} />
                  </div>
                  <span className="font-mono w-8 text-right text-text-secondary">{f.direction}{(f.importance * 100).toFixed(0)}%</span>
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
function BatchTab({ model }: { model: ModelInfo | null }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [progress, setProgress] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setFileName(file.name); setBatchResult(null); }
  };

  const handleProcess = useCallback(() => {
    setIsProcessing(true); setProgress(0); setBatchResult(null);
    const interval = setInterval(() => {
      setProgress((prev) => {
        const next = prev + Math.random() * 15 + 5;
        if (next >= 100) {
          clearInterval(interval);
          setIsProcessing(false);
          setBatchResult({ total: 1250, positive: 734, negative: 516, avgConfidence: 0.873, processedAt: new Date().toLocaleTimeString() });
          return 100;
        }
        return next;
      });
    }, 300);
  }, []);

  if (!model) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h3 className="text-sm font-semibold text">Select a Model</h3>
        <p className="mt-1 text-xs text-text-tertiary">Choose a model to run batch predictions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className={cn(
        "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-all",
        fileName ? "border-success/30 bg-success-muted/20" : "border-border hover:border-text-tertiary/40"
      )}>
        {fileName ? (
          <>
            <p className="text-sm font-medium text">{fileName}</p>
            <p className="text-xs text-text-tertiary mt-0.5">Ready for processing</p>
            <button onClick={() => { setFileName(null); setBatchResult(null); }} className="text-xs text-text-tertiary hover:text-text mt-2">Change file</button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text">Upload prediction data</p>
            <p className="mt-0.5 text-xs text-text-tertiary">CSV, JSONL, or Parquet — up to 500 MB</p>
            <input ref={fileInputRef} type="file" accept=".csv,.jsonl,.parquet" onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="btn btn-secondary mt-3 text-xs">Browse Files</button>
          </>
        )}
      </div>

      {fileName && !batchResult && (
        <button onClick={handleProcess} disabled={isProcessing} className="btn btn-primary w-full py-2.5">
          {isProcessing ? `Processing… ${progress.toFixed(0)}%` : "Run Batch Prediction"}
        </button>
      )}

      {isProcessing && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}

      {batchResult && (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="rounded-lg border border-success/20 bg-success-muted/30 p-5">
            <h3 className="text-sm font-semibold text">Batch Complete</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Processed at {batchResult.processedAt}</p>
            <div className="grid gap-3 sm:grid-cols-4 mt-4">
              {[
                { label: "Total", value: batchResult.total.toLocaleString() },
                { label: "Positive", value: batchResult.positive.toLocaleString() },
                { label: "Negative", value: batchResult.negative.toLocaleString() },
                { label: "Avg Confidence", value: `${(batchResult.avgConfidence * 100).toFixed(1)}%` },
              ].map((s) => (
                <div key={s.label} className="rounded-md bg-surface p-3 border border-border-subtle text-center">
                  <p className="text-lg font-semibold font-mono">{s.value}</p>
                  <p className="text-[10px] text-text-tertiary uppercase tracking-wider mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1">Download Results</button>
            <button className="btn btn-secondary flex-1">View Details</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  API Tab                                                            */
/* ------------------------------------------------------------------ */
function APITab({ model }: { model: ModelInfo | null }) {
  const [copied, setCopied] = useState<string | null>(null);

  if (!model) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <h3 className="text-sm font-semibold text">Select a Model</h3>
        <p className="mt-1 text-xs text-text-tertiary">Choose a model to see its API endpoint.</p>
      </div>
    );
  }

  const endpoint = `https://api.Kadence.com/v1/predict/${model.id}`;

  const curlExample = `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -d '{"features": {"age": 35, "income": 52000}}'`;

  const pythonExample = `import requests

response = requests.post(
    "${endpoint}",
    headers={"Authorization": "Bearer YOUR_API_KEY"},
    json={"features": {"age": 35, "income": 52000}}
)
print(response.json())`;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <p className="section-label">Endpoint</p>
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-primary p-3">
          <span className="rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-medium text-green-400">POST</span>
          <code className="flex-1 truncate text-sm font-mono text-white/80">{endpoint}</code>
          <button onClick={() => handleCopy(endpoint, "ep")} className="rounded p-1.5 hover:bg-white/10 transition-colors">
            <span className="text-xs text-white/50">{copied === "ep" ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>

      {[{ id: "curl", label: "cURL", code: curlExample }, { id: "python", label: "Python", code: pythonExample }].map((ex) => (
        <div key={ex.id} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="section-label">{ex.label}</p>
            <button onClick={() => handleCopy(ex.code, ex.id)} className="text-xs text-text-tertiary hover:text-text transition-colors">
              {copied === ex.id ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <div className="bg-primary px-4 py-1.5 border-b border-white/10">
              <span className="text-[11px] text-white/30">{ex.label.toLowerCase()}</span>
            </div>
            <pre className="bg-primary p-4 text-xs text-white/60 overflow-x-auto leading-relaxed">
              <code>{ex.code}</code>
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History Tab                                                        */
/* ------------------------------------------------------------------ */
function HistoryTab() {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="section-label">Recent Predictions</p>
        <button className="text-xs text-text-tertiary hover:text-text transition-colors">Clear</button>
      </div>
      <div className="space-y-1.5">
        {mockHistory.map((item) => (
          <div key={item.id} className="flex items-center justify-between rounded-lg border border-border-subtle p-3 hover:bg-surface-2/50 transition-colors">
            <div>
              <p className="text-[13px] font-medium text">{item.model}</p>
              <p className="text-[11px] text-text-tertiary font-mono">{item.input}</p>
            </div>
            <div className="text-right">
              <p className={cn("text-[13px] font-medium", item.result === "Positive" ? "text-success" : "text-danger")}>
                {item.result} ({(item.confidence * 100).toFixed(0)}%)
              </p>
              <p className="text-[11px] text-text-tertiary">{item.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */
export function MLPredictionPage() {
  const navigate = useNavigate();
  const [selectedModelId, setSelectedModelId] = useState<string | null>("m-1");
  const [activeTab, setActiveTab] = useState<PredictionTab>("playground");
  const [isPredicting, setIsPredicting] = useState(false);
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);

  const selectedModel = mockModels.find((m) => m.id === selectedModelId) || null;

  const handlePredict = useCallback((_inputs: Record<string, string>) => {
    setIsPredicting(true);
    setPredictionResult(null);
    setTimeout(() => {
      const isPositive = Math.random() > 0.4;
      const conf = 0.75 + Math.random() * 0.2;
      setPredictionResult({
        value: isPositive ? "Positive" : "Negative",
        confidence: conf,
        probabilities: [
          { label: "Positive", prob: isPositive ? conf : 1 - conf },
          { label: "Negative", prob: isPositive ? 1 - conf : conf },
        ],
        latency: Math.floor(Math.random() * 15 + 5),
      });
      setIsPredicting(false);
    }, 1200);
  }, []);

  const TABS: { key: PredictionTab; label: string }[] = [
    { key: "playground", label: "Playground" },
    { key: "batch", label: "Batch" },
    { key: "api", label: "API" },
    { key: "history", label: "History" },
  ];

  return (
    <section className="animate-in fade-in duration-200">
      <PageHeader
        title="Model Prediction"
        subtitle="Run inference, test models, and integrate via API."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate("/ml-training")} className="btn btn-secondary text-[13px]">Train New Model</button>
            <button className="btn btn-secondary text-[13px]">Export</button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr] p-6">
        {/* Model Sidebar */}
        <div className="space-y-4">
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between px-1">
              <p className="section-label">Models</p>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
                {mockModels.filter((m) => m.status === "ready").length} ready
              </span>
            </div>
            <div className="space-y-1.5">
              {mockModels.map((model) => (
                <ModelCard key={model.id} model={model} isSelected={selectedModelId === model.id}
                  onSelect={() => { setSelectedModelId(model.id); setPredictionResult(null); }} />
              ))}
            </div>
          </div>

          {selectedModel && (
            <div className="card p-3 space-y-2">
              <p className="section-label px-1">Details</p>
              <div className="space-y-1.5 text-xs px-1">
                {[
                  { label: "Algorithm", value: selectedModel.algorithm },
                  { label: "Version", value: `v${selectedModel.version}` },
                  { label: "Created", value: selectedModel.createdAt },
                  { label: "Features", value: `${selectedModel.features.length} inputs` },
                  { label: "Latency", value: selectedModel.latency },
                  { label: "Size", value: selectedModel.size },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between">
                    <span className="text-text-tertiary">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-border-subtle px-1">
                <p className="section-label mb-1.5">Features</p>
                <div className="flex flex-wrap gap-1">
                  {selectedModel.features.map((f) => (
                    <span key={f} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">{f}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main */}
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="border-b border-border-subtle px-1.5 py-1.5">
              <div className="flex rounded-md bg-surface-2/50 p-0.5">
                {TABS.map((tab) => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                    className={cn("flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all",
                      activeTab === tab.key ? "bg-surface text-text shadow-sm" : "text-text-tertiary hover:text-text-secondary"
                    )}>{tab.label}</button>
                ))}
              </div>
            </div>
            <div className="p-5">
              {activeTab === "playground" && (
                <PlaygroundTab model={selectedModel} onPredict={handlePredict} isPredicting={isPredicting} result={predictionResult} />
              )}
              {activeTab === "batch" && <BatchTab model={selectedModel} />}
              {activeTab === "api" && <APITab model={selectedModel} />}
              {activeTab === "history" && <HistoryTab />}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}