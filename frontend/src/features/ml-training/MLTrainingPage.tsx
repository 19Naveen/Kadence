import { useState, useEffect, useRef, useCallback } from "react";
import { PageHeader } from "../../components/shared/PageHeader";
import { cn } from "../../lib/cn";
import { datasets } from "../../lib/mocks/data";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type Step = "model" | "dataset" | "parameters" | "train";
type ProblemType = "Classification" | "Regression";
type Algorithm =
  | "XGBoost"
  | "Random Forest"
  | "Logistic Regression"
  | "Neural Network"
  | "LightGBM"
  | "SVM";
type TrainingStatus = "idle" | "preparing" | "training" | "completed" | "error";

interface TrainingConfig {
  modelName: string;
  problemType: ProblemType;
  algorithm: Algorithm;
  learningRate: number;
  epochs: number;
  batchSize: number;
  trainSplit: number;
  crossValidation: number;
  earlyStopping: boolean;
  patience: number;
  weightDecay: number;
  scheduler: "constant" | "cosine" | "linear";
  datasetId: string;
}

interface EpochMetric {
  epoch: number;
  loss: number;
  valLoss: number;
  accuracy: number;
  valAccuracy: number;
  lr: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const STEPS: { key: Step; label: string; description: string }[] = [
  { key: "model", label: "Model", description: "Algorithm & problem type" },
  { key: "dataset", label: "Dataset", description: "Select imported data" },
  { key: "parameters", label: "Parameters", description: "Hyperparameter tuning" },
  { key: "train", label: "Training", description: "Run & monitor" },
];

const ALGORITHMS: { value: Algorithm; label: string; description: string; speed: string }[] = [
  { value: "XGBoost", label: "XGBoost", description: "Gradient boosted trees — fast & accurate", speed: "Fast" },
  { value: "Random Forest", label: "Random Forest", description: "Ensemble of decision trees — robust", speed: "Medium" },
  { value: "LightGBM", label: "LightGBM", description: "Light gradient boosting — memory efficient", speed: "Fast" },
  { value: "Neural Network", label: "Neural Network", description: "Deep learning — flexible architecture", speed: "Slow" },
  { value: "Logistic Regression", label: "Logistic Regression", description: "Linear classifier — interpretable", speed: "Instant" },
  { value: "SVM", label: "SVM", description: "Support vector machine — strong margins", speed: "Medium" },
];

/* ------------------------------------------------------------------ */
/*  SVG Chart                                                          */
/* ------------------------------------------------------------------ */
function SparklineChart({
  data,
  color,
  height = 100,
  label,
  currentValue,
}: {
  data: number[];
  color: string;
  height?: number;
  label: string;
  currentValue?: string;
}) {
  if (data.length < 2) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ height }}>
        <span className="text-xs text-text-tertiary">Waiting for data…</span>
      </div>
    );
  }

  const padding = 4;
  const width = 300;
  const max = Math.max(...data) * 1.05;
  const min = Math.min(...data) * 0.95;
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - 2 * padding);
    const y = padding + ((max - v) / range) * (height - 2 * padding);
    return `${x},${y}`;
  });

  const pathD = `M${points.join(" L")}`;
  const areaD = `${pathD} L${width - padding},${height - padding} L${padding},${height - padding} Z`;

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <span className="section-label">{label}</span>
        {currentValue && (
          <span className="font-mono text-sm font-semibold" style={{ color }}>{currentValue}</span>
        )}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        <defs>
          <linearGradient id={`grad-${label.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.15" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#grad-${label.replace(/\s/g, "")})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.length > 0 && (
          <circle
            cx={padding + ((data.length - 1) / (data.length - 1)) * (width - 2 * padding)}
            cy={padding + ((max - data[data.length - 1]) / range) * (height - 2 * padding)}
            r="3"
            fill={color}
          >
            <animate attributeName="r" values="3;4.5;3" dur="2s" repeatCount="indefinite" />
          </circle>
        )}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Resource Bar                                                       */
/* ------------------------------------------------------------------ */
function ResourceBar({ label, value, max, unit }: {
  label: string; value: number; max: number; unit: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-tertiary">{label}</span>
        <span className="font-mono text-text-secondary">{value.toFixed(1)}{unit} / {max}{unit}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step Indicator                                                     */
/* ------------------------------------------------------------------ */
function StepIndicator({
  steps,
  currentStep,
  completedSteps,
  onStepClick,
}: {
  steps: typeof STEPS;
  currentStep: Step;
  completedSteps: Set<Step>;
  onStepClick: (s: Step) => void;
}) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const isActive = currentStep === step.key;
        const isCompleted = completedSteps.has(step.key);
        const isClickable = isCompleted || steps.findIndex(s => s.key === currentStep) >= i;

        return (
          <button
            key={step.key}
            onClick={() => isClickable && onStepClick(step.key)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-all duration-150",
              isActive
                ? "bg-surface-2 border border-border"
                : isCompleted
                  ? "hover:bg-surface-2/60"
                  : "opacity-50"
            )}
            disabled={!isClickable}
          >
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md text-xs font-semibold transition-all",
                isActive
                  ? "bg-primary text-white"
                  : isCompleted
                    ? "bg-surface-3 text-text"
                    : "bg-surface-3 text-text-tertiary"
              )}
            >
              {isCompleted && !isActive ? (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn(
                "text-[13px] font-medium",
                isActive ? "text-text" : "text-text-secondary"
              )}>
                {step.label}
              </p>
              <p className="text-[11px] text-text-tertiary truncate">{step.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Model Step                                                         */
/* ------------------------------------------------------------------ */
function ModelStep({
  config,
  setConfig,
}: {
  config: TrainingConfig;
  setConfig: (c: TrainingConfig) => void;
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-base font-semibold text">Model Configuration</h2>
        <p className="mt-1 text-[13px] text-text-secondary">Choose the algorithm and problem type for your training run.</p>
      </div>

      <div className="space-y-1.5">
        <label className="section-label">Model Name</label>
        <input
          type="text"
          value={config.modelName}
          onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
          placeholder="e.g., customer_churn_v1"
          className="input"
        />
      </div>

      <div className="space-y-1.5">
        <label className="section-label">Problem Type</label>
        <div className="grid grid-cols-2 gap-3">
          {(["Classification", "Regression"] as ProblemType[]).map((pt) => (
            <button
              key={pt}
              onClick={() => setConfig({ ...config, problemType: pt })}
              className={cn(
                "rounded-lg border p-4 text-left transition-all duration-150",
                config.problemType === pt
                  ? "border-primary bg-primary/3"
                  : "border-border-subtle hover:border-border"
              )}
            >
              <p className="text-sm font-semibold text">{pt}</p>
              <p className="text-xs text-text-tertiary mt-0.5">
                {pt === "Classification" ? "Predict discrete categories" : "Predict continuous values"}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="section-label">Algorithm</label>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ALGORITHMS.map((alg) => (
            <button
              key={alg.value}
              onClick={() => setConfig({ ...config, algorithm: alg.value })}
              className={cn(
                "rounded-lg border p-3.5 text-left transition-all duration-150",
                config.algorithm === alg.value
                  ? "border-primary bg-primary/3"
                  : "border-border-subtle hover:border-border"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text">{alg.label}</p>
                <span className={cn(
                  "rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                  alg.speed === "Fast" ? "bg-success-muted text-success" :
                    alg.speed === "Instant" ? "bg-info-muted text-info" :
                      alg.speed === "Slow" ? "bg-warning-muted text-warning" :
                        "bg-surface-3 text-text-tertiary"
                )}>
                  {alg.speed}
                </span>
              </div>
              <p className="text-[11px] text-text-tertiary leading-relaxed">{alg.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dataset Step — imported data only                                  */
/* ------------------------------------------------------------------ */
function DatasetStep({
  config,
  setConfig,
}: {
  config: TrainingConfig;
  setConfig: (c: TrainingConfig) => void;
}) {
  const selectedDataset = datasets.find((ds) => ds.id === config.datasetId);

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-base font-semibold text">Select Dataset</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Choose from datasets already imported into your workspace.
        </p>
      </div>

      {datasets.length === 0 ? (
        <div className="rounded-lg border border-border-subtle p-8 text-center">
          <p className="text-sm text-text-secondary">No datasets imported yet.</p>
          <p className="mt-1 text-xs text-text-tertiary">Go to Data Import to add datasets to your workspace.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {datasets.map((ds) => (
            <button
              key={ds.id}
              onClick={() => setConfig({ ...config, datasetId: ds.id })}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border p-4 transition-all duration-150",
                config.datasetId === ds.id
                  ? "border-primary bg-primary/3"
                  : "border-border-subtle hover:border-border"
              )}
            >
              <div className="text-left">
                <p className="text-sm font-medium text">{ds.name}</p>
                <p className="text-xs text-text-tertiary mt-0.5">
                  {ds.rows.toLocaleString()} rows · {ds.columns} columns · Owner: {ds.owner}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs text-text-tertiary">Quality</p>
                  <p className="text-sm font-mono font-medium">{ds.qualityScore}%</p>
                </div>
                <span className={cn(
                  "rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                  ds.freshness === "live" ? "bg-success-muted text-success" :
                    ds.freshness === "daily" ? "bg-info-muted text-info" :
                      "bg-surface-3 text-text-tertiary"
                )}>
                  {ds.freshness}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Data Preview */}
      {selectedDataset && (
        <div className="rounded-lg border border-border-subtle overflow-hidden">
          <div className="bg-surface-2/50 px-4 py-2.5 border-b border-border-subtle flex items-center justify-between">
            <span className="section-label">Preview — {selectedDataset.name}</span>
            <span className="text-[11px] text-text-tertiary">First 5 rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle bg-surface-2/30">
                  {["id", "age", "income", "education", "balance", "target"].map((h) => (
                    <th key={h} className="px-4 py-2 text-left font-medium text-text-tertiary">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  [1, 35, 52000, "Bachelor", 12400, 1],
                  [2, 28, 34000, "Master", 8200, 0],
                  [3, 45, 78000, "PhD", 34500, 1],
                  [4, 52, 61000, "High School", 5600, 0],
                  [5, 31, 45000, "Bachelor", 15800, 1],
                ].map((row, i) => (
                  <tr key={i} className="border-b border-border-subtle/50 hover:bg-surface-2/30 transition-colors">
                    {row.map((cell, j) => (
                      <td key={j} className="px-4 py-1.5 font-mono text-text-secondary">
                        {typeof cell === "number" ? cell.toLocaleString() : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedDataset && selectedDataset.issues.length > 0 && (
        <div className="rounded-lg border border-warning/20 bg-warning-muted/50 p-3">
          <p className="text-xs font-medium text-warning mb-1">Data Issues</p>
          <ul className="space-y-0.5">
            {selectedDataset.issues.map((issue, i) => (
              <li key={i} className="text-[11px] text-text-secondary">· {issue}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Parameters Step                                                    */
/* ------------------------------------------------------------------ */
function ParametersStep({
  config,
  setConfig,
}: {
  config: TrainingConfig;
  setConfig: (c: TrainingConfig) => void;
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-base font-semibold text">Hyperparameters</h2>
        <p className="mt-1 text-[13px] text-text-secondary">Fine-tune your model parameters. Defaults are pre-filled.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Core */}
        <div className="rounded-lg border border-border-subtle p-5 space-y-5">
          <h3 className="text-sm font-semibold text">Core Parameters</h3>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Learning Rate</label>
              <span className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-xs font-medium">{config.learningRate.toFixed(4)}</span>
            </div>
            <input type="range" min={0.0001} max={1} step={0.0001} value={config.learningRate}
              onChange={(e) => setConfig({ ...config, learningRate: parseFloat(e.target.value) })}
              className="w-full accent-primary" />
            <div className="flex justify-between text-[10px] text-text-tertiary"><span>0.0001</span><span>1.0</span></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Epochs</label>
              <span className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-xs font-medium">{config.epochs}</span>
            </div>
            <input type="range" min={5} max={500} step={5} value={config.epochs}
              onChange={(e) => setConfig({ ...config, epochs: parseInt(e.target.value) })}
              className="w-full accent-primary" />
            <div className="flex justify-between text-[10px] text-text-tertiary"><span>5</span><span>500</span></div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary">Batch Size</label>
            <div className="flex gap-1.5">
              {[8, 16, 32, 64, 128, 256].map((bs) => (
                <button key={bs} onClick={() => setConfig({ ...config, batchSize: bs })}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-xs font-medium transition-all",
                    config.batchSize === bs ? "bg-primary text-white" : "bg-surface-2 text-text-secondary hover:bg-surface-3"
                  )}>{bs}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Advanced */}
        <div className="rounded-lg border border-border-subtle p-5 space-y-5">
          <h3 className="text-sm font-semibold text">Advanced</h3>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Train / Validation Split</label>
              <span className="font-mono text-xs text-text-tertiary">{config.trainSplit}% / {100 - config.trainSplit}%</span>
            </div>
            <input type="range" min={60} max={95} step={5} value={config.trainSplit}
              onChange={(e) => setConfig({ ...config, trainSplit: parseInt(e.target.value) })}
              className="w-full accent-primary" />
            <div className="flex">
              <div className="h-1.5 rounded-l-full bg-primary/50 transition-all" style={{ width: `${config.trainSplit}%` }} />
              <div className="h-1.5 rounded-r-full bg-surface-3 transition-all" style={{ width: `${100 - config.trainSplit}%` }} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Weight Decay</label>
              <span className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-xs">{config.weightDecay}</span>
            </div>
            <input type="range" min={0} max={0.5} step={0.01} value={config.weightDecay}
              onChange={(e) => setConfig({ ...config, weightDecay: parseFloat(e.target.value) })}
              className="w-full accent-primary" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-secondary">LR Scheduler</label>
            <div className="flex gap-1.5">
              {(["constant", "cosine", "linear"] as const).map((s) => (
                <button key={s} onClick={() => setConfig({ ...config, scheduler: s })}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-xs font-medium capitalize transition-all",
                    config.scheduler === s ? "bg-primary text-white" : "bg-surface-2 text-text-secondary hover:bg-surface-3"
                  )}>{s}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">CV Folds</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setConfig({ ...config, crossValidation: Math.max(2, config.crossValidation - 1) })}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-2 text-text-secondary hover:bg-surface-3 text-sm">−</button>
                <span className="flex-1 text-center font-mono text-sm font-medium">{config.crossValidation}</span>
                <button onClick={() => setConfig({ ...config, crossValidation: Math.min(10, config.crossValidation + 1) })}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-surface-2 text-text-secondary hover:bg-surface-3 text-sm">+</button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Early Stopping</label>
              <button onClick={() => setConfig({ ...config, earlyStopping: !config.earlyStopping })}
                className={cn("relative flex h-7 w-12 items-center rounded-full px-0.5 transition-colors duration-150",
                  config.earlyStopping ? "bg-primary" : "bg-surface-3"
                )}>
                <span className={cn("h-6 w-6 rounded-full bg-white shadow-sm transition-transform duration-150",
                  config.earlyStopping ? "translate-x-5" : "translate-x-0"
                )} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-border-subtle bg-surface-2/30 p-4">
        <p className="section-label mb-2">Configuration Summary</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          {[
            { label: "Algorithm", value: config.algorithm },
            { label: "LR", value: config.learningRate.toString() },
            { label: "Epochs", value: config.epochs.toString() },
            { label: "Batch", value: config.batchSize.toString() },
            { label: "Split", value: `${config.trainSplit}%` },
            { label: "Scheduler", value: config.scheduler },
          ].map((item) => (
            <div key={item.label}>
              <span className="text-text-tertiary">{item.label}</span>
              <p className="font-mono font-medium mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Training Step                                                      */
/* ------------------------------------------------------------------ */
function TrainStep({
  config,
  status,
  progress,
  epoch,
  metrics,
  logs,
  gpuUtil,
  memUtil,
  onStart,
  onStop,
  elapsedTime,
}: {
  config: TrainingConfig;
  status: TrainingStatus;
  progress: number;
  epoch: number;
  metrics: EpochMetric[];
  logs: string[];
  gpuUtil: number;
  memUtil: number;
  onStart: () => void;
  onStop: () => void;
  elapsedTime: number;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  };

  const lossData = metrics.map((m) => m.loss);
  const valLossData = metrics.map((m) => m.valLoss);
  const accData = metrics.map((m) => m.accuracy);
  const latestMetric = metrics[metrics.length - 1];

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text">
            {status === "idle" ? "Ready to Train" :
              status === "preparing" ? "Preparing…" :
                status === "training" ? "Training in Progress" :
                  status === "completed" ? "Training Complete" : "Error"}
          </h2>
          <p className="mt-0.5 text-[13px] text-text-secondary">
            {config.modelName || "Untitled"} · {config.algorithm} · {config.epochs} epochs
          </p>
        </div>
        {status === "idle" && (
          <button onClick={onStart} className="btn btn-primary">Start Training</button>
        )}
        {(status === "training" || status === "preparing") && (
          <button onClick={onStop} className="btn btn-danger">Stop</button>
        )}
      </div>

      {/* Progress */}
      {(status === "training" || status === "completed") && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-text-tertiary">
            <span>Epoch {epoch} / {config.epochs}</span>
            <span>{progress.toFixed(1)}% · {formatTime(elapsedTime)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn("h-full rounded-full transition-all duration-500 ease-out",
                status === "completed" ? "bg-success" : "bg-primary"
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Metric cards */}
      {(status === "training" || status === "completed") && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Loss", value: latestMetric?.loss.toFixed(4) ?? "—", color: "text-danger" },
            { label: "Val Loss", value: latestMetric?.valLoss.toFixed(4) ?? "—", color: "text-warning" },
            { label: "Accuracy", value: latestMetric ? `${(latestMetric.accuracy * 100).toFixed(1)}%` : "—", color: "text-success" },
            { label: "Val Acc", value: latestMetric ? `${(latestMetric.valAccuracy * 100).toFixed(1)}%` : "—", color: "text-info" },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-border-subtle p-3">
              <p className="text-[11px] font-medium text-text-tertiary">{m.label}</p>
              <p className={cn("mt-0.5 text-lg font-semibold font-mono", m.color)}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Charts */}
      {(status === "training" || status === "completed") && metrics.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border-subtle p-4">
            <SparklineChart data={lossData} color="hsl(0, 72%, 51%)" label="Training Loss" currentValue={latestMetric?.loss.toFixed(4)} />
            {valLossData.length > 1 && (
              <div className="mt-3 pt-3 border-t border-border-subtle">
                <SparklineChart data={valLossData} color="hsl(32, 95%, 44%)" height={70} label="Validation Loss" currentValue={latestMetric?.valLoss.toFixed(4)} />
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border-subtle p-4">
            <SparklineChart data={accData} color="hsl(142, 72%, 29%)" label="Accuracy" currentValue={latestMetric ? `${(latestMetric.accuracy * 100).toFixed(1)}%` : undefined} />
          </div>
        </div>
      )}

      {/* Resources */}
      {(status === "training" || status === "preparing") && (
        <div className="rounded-lg border border-border-subtle p-4 space-y-3">
          <p className="section-label">Resource Utilization</p>
          <ResourceBar label="GPU" value={gpuUtil} max={100} unit="%" />
          <ResourceBar label="Memory" value={memUtil} max={16} unit=" GB" />
        </div>
      )}

      {/* Logs */}
      <div className="rounded-lg border border-border-subtle overflow-hidden">
        <div className="flex items-center justify-between bg-primary px-4 py-2">
          <span className="text-xs font-medium text-white/70">Logs</span>
          <div className="flex gap-1">
            <div className="h-2 w-2 rounded-full bg-white/20" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
            <div className="h-2 w-2 rounded-full bg-white/20" />
          </div>
        </div>
        <div className="h-44 overflow-y-auto bg-primary p-4 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? (
            <span className="text-white/30">Waiting to start…</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={cn("mb-0.5",
                log.includes("ERROR") ? "text-red-400" :
                  log.includes("✓") || log.includes("Complete") || log.includes("saved") ? "text-green-400" :
                    "text-white/60"
              )}>{log}</div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Completed */}
      {status === "completed" && latestMetric && (
        <div className="rounded-lg border border-success/30 bg-success-muted/50 p-5 space-y-4">
          <div>
            <h3 className="text-base font-semibold text">Training Complete</h3>
            <p className="text-[13px] text-text-secondary">Model is ready for deployment.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md bg-surface p-3 border border-border-subtle">
              <p className="text-[11px] text-text-tertiary">Final Accuracy</p>
              <p className="mt-0.5 text-xl font-semibold text-success font-mono">{(latestMetric.accuracy * 100).toFixed(1)}%</p>
            </div>
            <div className="rounded-md bg-surface p-3 border border-border-subtle">
              <p className="text-[11px] text-text-tertiary">Final Loss</p>
              <p className="mt-0.5 text-xl font-semibold font-mono">{latestMetric.loss.toFixed(4)}</p>
            </div>
            <div className="rounded-md bg-surface p-3 border border-border-subtle">
              <p className="text-[11px] text-text-tertiary">Duration</p>
              <p className="mt-0.5 text-xl font-semibold font-mono">{formatTime(elapsedTime)}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1">Export Model</button>
            <button className="btn btn-secondary flex-1">Deploy</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                           */
/* ------------------------------------------------------------------ */
export function MLTrainingPage() {
  const [currentStep, setCurrentStep] = useState<Step>("model");
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(new Set());
  const [config, setConfig] = useState<TrainingConfig>({
    modelName: "customer_churn_v1",
    problemType: "Classification",
    algorithm: "XGBoost",
    learningRate: 0.01,
    epochs: 100,
    batchSize: 32,
    trainSplit: 80,
    crossValidation: 5,
    earlyStopping: true,
    patience: 10,
    weightDecay: 0.01,
    scheduler: "cosine",
    datasetId: datasets[0]?.id ?? "",
  });
  const [status, setStatus] = useState<TrainingStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [metrics, setMetrics] = useState<EpochMetric[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [gpuUtil, setGpuUtil] = useState(0);
  const [memUtil, setMemUtil] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const trainingInterval = useRef<number | null>(null);
  const timerInterval = useRef<number | null>(null);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
    setLogs((prev) => [...prev, `[${ts}] ${msg}`]);
  }, []);

  const selectedDataset = datasets.find((ds) => ds.id === config.datasetId);

  const startTraining = useCallback(() => {
    if (status === "training") return;
    setStatus("preparing");
    setProgress(0);
    setEpoch(0);
    setMetrics([]);
    setLogs([]);
    setElapsedTime(0);

    addLog("Initializing training pipeline…");
    addLog(`  Model: ${config.modelName}`);
    addLog(`  Algorithm: ${config.algorithm}`);
    addLog(`  Learning Rate: ${config.learningRate}`);
    addLog(`  Epochs: ${config.epochs}`);
    addLog(`  Batch Size: ${config.batchSize}`);

    setTimeout(() => {
      addLog(`Loading dataset: ${selectedDataset?.name ?? "unknown"} (${(selectedDataset?.rows ?? 0).toLocaleString()} samples)`);
    }, 400);

    setTimeout(() => {
      addLog("✓ Dataset loaded and validated");
      addLog(`  Train: ${config.trainSplit}% · Val: ${100 - config.trainSplit}%`);
    }, 800);

    setTimeout(() => {
      addLog("Preprocessing features…");
      addLog("✓ Feature scaling complete");
      addLog("✓ Categorical encoding complete");
      addLog("Starting training loop…");
      setStatus("training");

      timerInterval.current = window.setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);

      let currentEpoch = 0;
      trainingInterval.current = window.setInterval(() => {
        currentEpoch += 1;
        const newProgress = (currentEpoch / config.epochs) * 100;
        const loss = 1.8 * Math.exp(-currentEpoch / 25) + 0.08 + Math.random() * 0.03;
        const valLoss = 1.8 * Math.exp(-currentEpoch / 28) + 0.12 + Math.random() * 0.04;
        const accuracy = 0.5 + 0.46 * (1 - Math.exp(-currentEpoch / 18)) + Math.random() * 0.015;
        const valAccuracy = 0.5 + 0.43 * (1 - Math.exp(-currentEpoch / 22)) + Math.random() * 0.02;
        const lr = config.scheduler === "cosine"
          ? config.learningRate * 0.5 * (1 + Math.cos(Math.PI * currentEpoch / config.epochs))
          : config.scheduler === "linear"
            ? config.learningRate * (1 - currentEpoch / config.epochs)
            : config.learningRate;

        setProgress(newProgress);
        setEpoch(currentEpoch);
        setMetrics((prev) => [...prev, { epoch: currentEpoch, loss, valLoss, accuracy, valAccuracy, lr }]);
        setGpuUtil(65 + Math.random() * 30);
        setMemUtil(8 + Math.random() * 5);

        if (currentEpoch % 5 === 0 || currentEpoch === 1) {
          addLog(`  Epoch ${String(currentEpoch).padStart(3, " ")}/${config.epochs}  |  loss: ${loss.toFixed(4)}  |  val_loss: ${valLoss.toFixed(4)}  |  acc: ${(accuracy * 100).toFixed(1)}%  |  lr: ${lr.toFixed(6)}`);
        }

        if (currentEpoch >= config.epochs) {
          if (trainingInterval.current) clearInterval(trainingInterval.current);
          if (timerInterval.current) clearInterval(timerInterval.current);
          trainingInterval.current = null;
          timerInterval.current = null;
          addLog("✓ Training complete");
          addLog(`  Best validation accuracy: ${(valAccuracy * 100).toFixed(1)}%`);
          addLog("✓ Model saved to registry");
          setStatus("completed");
          setProgress(100);
          setGpuUtil(0);
          setMemUtil(0);
        }
      }, 150);
    }, 1500);
  }, [config, status, addLog, selectedDataset]);

  const stopTraining = useCallback(() => {
    if (trainingInterval.current) clearInterval(trainingInterval.current);
    if (timerInterval.current) clearInterval(timerInterval.current);
    trainingInterval.current = null;
    timerInterval.current = null;
    setStatus("idle");
    setGpuUtil(0);
    setMemUtil(0);
    addLog("Training stopped by user");
  }, [addLog]);

  useEffect(() => {
    return () => {
      if (trainingInterval.current) clearInterval(trainingInterval.current);
      if (timerInterval.current) clearInterval(timerInterval.current);
    };
  }, []);

  const handleNext = () => {
    const idx = STEPS.findIndex((s) => s.key === currentStep);
    if (idx < STEPS.length - 1) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep(STEPS[idx + 1].key);
    }
  };

  const handleBack = () => {
    const idx = STEPS.findIndex((s) => s.key === currentStep);
    if (idx > 0) setCurrentStep(STEPS[idx - 1].key);
  };

  const stepIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <section className="animate-in fade-in duration-200">
      <PageHeader
        title="Model Training"
        subtitle="Configure, train, and monitor machine learning models."
        actions={
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary text-[13px]">History</button>
            <button className="btn btn-primary text-[13px]">New Model</button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[240px_1fr] p-6">
        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card p-3">
            <StepIndicator steps={STEPS} currentStep={currentStep} completedSteps={completedSteps} onStepClick={setCurrentStep} />
          </div>
          <div className="card p-3 space-y-2">
            <p className="section-label px-1">Summary</p>
            <div className="space-y-1.5 text-xs px-1">
              {[
                { label: "Algorithm", value: config.algorithm },
                { label: "Problem", value: config.problemType },
                { label: "Dataset", value: selectedDataset?.name?.split(".")[0] ?? "—" },
                { label: "Epochs", value: config.epochs },
                { label: "Status", value: status === "idle" ? "Ready" : status.charAt(0).toUpperCase() + status.slice(1), highlight: status === "training" || status === "completed" },
              ].map((item) => (
                <div key={item.label} className="flex justify-between">
                  <span className="text-text-tertiary">{item.label}</span>
                  <span className={cn("font-medium", item.highlight ? (status === "completed" ? "text-success" : "text-accent") : "")}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <div className="card p-6">
            {currentStep === "model" && <ModelStep config={config} setConfig={setConfig} />}
            {currentStep === "dataset" && <DatasetStep config={config} setConfig={setConfig} />}
            {currentStep === "parameters" && <ParametersStep config={config} setConfig={setConfig} />}
            {currentStep === "train" && (
              <TrainStep config={config} status={status} progress={progress} epoch={epoch}
                metrics={metrics} logs={logs} gpuUtil={gpuUtil} memUtil={memUtil}
                onStart={startTraining} onStop={stopTraining} elapsedTime={elapsedTime} />
            )}
          </div>
          {currentStep !== "train" && (
            <div className="flex items-center justify-between">
              <button onClick={handleBack} disabled={stepIndex === 0}
                className={cn("btn btn-secondary", stepIndex === 0 && "opacity-40 pointer-events-none")}>
                Back
              </button>
              <span className="text-xs text-text-tertiary">Step {stepIndex + 1} of {STEPS.length}</span>
              <button onClick={handleNext} className="btn btn-primary">
                {stepIndex === STEPS.length - 2 ? "Go to Training" : "Continue"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}