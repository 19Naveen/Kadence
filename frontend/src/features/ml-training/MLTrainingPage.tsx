import { useState, useEffect, useRef, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Play, RotateCcw, Square } from "lucide-react";
import { PageHeader } from "../../components/shared/PageHeader";
import { PreviewNotice } from "../../components/shared/PreviewNotice";
import { cn } from "../../lib/cn";
import { formatCount, formatDate, plural } from "../../lib/format";
import { useDatasets, useQueryApi } from "../../lib/hooks/useDatasets";
import type { DatasetPreview, DatasetSummary } from "../../lib/hooks/useDatasets";

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
type TrainingStatus = "idle" | "preparing" | "training" | "completed" | "stopped";

interface TrainingConfig {
  modelName: string;
  problemType: ProblemType;
  algorithm: Algorithm;
  learningRate: number;
  epochs: number;
  batchSize: number;
  trainSplit: number;
  weightDecay: number;
  scheduler: "constant" | "cosine" | "linear";
  datasetId: string;
  targetColumn: string;
  featureColumns: string[];
}

type SetConfig = Dispatch<SetStateAction<TrainingConfig>>;

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
  { key: "model", label: "Model", description: "Algorithm and problem type" },
  { key: "dataset", label: "Dataset", description: "Data, target and features" },
  { key: "parameters", label: "Parameters", description: "Hyperparameters" },
  { key: "train", label: "Training", description: "Run and monitor" },
];

const ALGORITHMS: { value: Algorithm; description: string; speed: string }[] = [
  { value: "XGBoost", description: "Gradient boosted trees, fast and accurate", speed: "Fast" },
  { value: "Random Forest", description: "Ensemble of decision trees, robust", speed: "Medium" },
  { value: "LightGBM", description: "Light gradient boosting, memory efficient", speed: "Fast" },
  { value: "Neural Network", description: "Deep learning, flexible architecture", speed: "Slow" },
  { value: "Logistic Regression", description: "Linear classifier, interpretable", speed: "Instant" },
  { value: "SVM", description: "Support vector machine, strong margins", speed: "Medium" },
];

const LEARNING_RATES = [0.0001, 0.0003, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1];
const BATCH_SIZES = [8, 16, 32, 64, 128, 256];
const SCHEDULERS = ["constant", "cosine", "linear"] as const;

const choiceCard = (active: boolean) =>
  cn(
    "rounded-lg border text-left transition-colors",
    active ? "border-primary bg-primary-muted" : "border-border-subtle hover:border-border",
  );

const chip = (active: boolean) =>
  cn(
    "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
    active ? "bg-primary-muted text-primary ring-1 ring-primary/30" : "bg-surface-2 text-text-secondary hover:bg-surface-3",
  );

/* ------------------------------------------------------------------ */
/*  SVG Chart                                                          */
/* ------------------------------------------------------------------ */
/** `className` sets the colour (e.g. "text-danger"); the SVG strokes inherit it. */
function SparklineChart({
  data,
  className,
  height = 100,
  label,
  currentValue,
}: {
  data: number[];
  className: string;
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
  const gradId = `grad-${label.replace(/\s/g, "")}`;

  return (
    <div className={cn("relative", className)}>
      <div className="mb-2 flex items-center justify-between">
        <span className="section-label">{label}</span>
        {currentValue && <span className="font-mono text-sm font-semibold">{currentValue}</span>}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} role="img" aria-label={`${label} over epochs (simulated)`}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradId})`} />
        <path d={pathD} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle
          cx={width - padding}
          cy={padding + ((max - data[data.length - 1]) / range) * (height - 2 * padding)}
          r="3"
          fill="currentColor"
        />
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
        <div className="h-full rounded-full bg-primary transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
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
  const currentIndex = steps.findIndex((s) => s.key === currentStep);
  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const isActive = currentStep === step.key;
        const isCompleted = completedSteps.has(step.key);
        const isClickable = isCompleted || currentIndex >= i;

        return (
          <button
            key={step.key}
            onClick={() => onStepClick(step.key)}
            aria-current={isActive ? "step" : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
              isActive ? "border border-border bg-surface-2" : isCompleted ? "hover:bg-surface-2" : "opacity-50",
            )}
            disabled={!isClickable}
          >
            <div
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                isActive ? "bg-primary-muted text-primary" : isCompleted ? "bg-surface-3 text-text" : "bg-surface-3 text-text-tertiary",
              )}
            >
              {isCompleted && !isActive ? <Check size={14} /> : i + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", isActive ? "text-text" : "text-text-secondary")}>{step.label}</p>
              <p className="truncate text-xs text-text-tertiary">{step.description}</p>
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
function ModelStep({ config, setConfig }: { config: TrainingConfig; setConfig: SetConfig }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text">Model configuration</h2>
        <p className="mt-1 text-sm text-text-secondary">Choose the algorithm and problem type for your training run.</p>
      </div>

      <div>
        <label htmlFor="ml-model-name" className="field-label">Model name</label>
        <input
          id="ml-model-name"
          type="text"
          value={config.modelName}
          onChange={(e) => setConfig((c) => ({ ...c, modelName: e.target.value }))}
          placeholder="e.g. churn_model_v1"
          className="input"
        />
      </div>

      <div>
        <span className="field-label" id="ml-problem-type">Problem type</span>
        <div className="grid grid-cols-2 gap-3" role="group" aria-labelledby="ml-problem-type">
          {(["Classification", "Regression"] as ProblemType[]).map((pt) => (
            <button
              key={pt}
              onClick={() => setConfig((c) => ({ ...c, problemType: pt }))}
              aria-pressed={config.problemType === pt}
              className={cn(choiceCard(config.problemType === pt), "p-4")}
            >
              <p className="text-sm font-semibold text-text">{pt}</p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                {pt === "Classification" ? "Predict discrete categories" : "Predict continuous values"}
              </p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="field-label" id="ml-algorithm">Algorithm</span>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-labelledby="ml-algorithm">
          {ALGORITHMS.map((alg) => (
            <button
              key={alg.value}
              onClick={() => setConfig((c) => ({ ...c, algorithm: alg.value }))}
              aria-pressed={config.algorithm === alg.value}
              className={cn(choiceCard(config.algorithm === alg.value), "p-3.5")}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-text">{alg.value}</p>
                <span
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 text-2xs font-medium",
                    alg.speed === "Fast" ? "bg-success-muted text-success"
                      : alg.speed === "Instant" ? "bg-info-muted text-info"
                        : alg.speed === "Slow" ? "bg-warning-muted text-warning"
                          : "bg-surface-3 text-text-tertiary",
                  )}
                >
                  {alg.speed}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-text-tertiary">{alg.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Dataset Step: real datasets, real preview, real columns            */
/* ------------------------------------------------------------------ */
function DatasetStep({
  config,
  setConfig,
  datasets,
  datasetsLoading,
}: {
  config: TrainingConfig;
  setConfig: SetConfig;
  datasets: DatasetSummary[];
  datasetsLoading: boolean;
}) {
  const { preview } = useQueryApi();
  const [loaded, setLoaded] = useState<{ id: string; data: DatasetPreview } | null>(null);
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null);
  const id = config.datasetId;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    preview(id, 10)
      .then((data) => {
        if (cancelled) return;
        setLoaded({ id, data });
        // Default the target to the last column unless the user already picked a valid one.
        setConfig((c) => {
          if (c.datasetId !== id || data.columns.includes(c.targetColumn)) return c;
          const target = data.columns[data.columns.length - 1] ?? "";
          return { ...c, targetColumn: target, featureColumns: data.columns.filter((col) => col !== target) };
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setFailed({ id, message: e instanceof Error ? e.message : "Failed to load preview" });
      });
    return () => { cancelled = true; };
  }, [id, preview, setConfig]);

  const data = loaded?.id === id ? loaded.data : null;
  const error = failed?.id === id ? failed.message : null;
  const previewLoading = !!id && !data && !error;

  const setTarget = (target: string) =>
    setConfig((c) => ({ ...c, targetColumn: target, featureColumns: c.featureColumns.filter((f) => f !== target) }));

  const toggleFeature = (col: string) =>
    setConfig((c) => ({
      ...c,
      featureColumns: c.featureColumns.includes(col) ? c.featureColumns.filter((f) => f !== col) : [...c.featureColumns, col],
    }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text">Select dataset</h2>
        <p className="mt-1 text-sm text-text-secondary">Choose a dataset from your workspace, then the column to predict and the columns to learn from.</p>
      </div>

      {datasetsLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border-subtle p-8 text-sm text-text-secondary">
          <LoaderCircle size={16} className="animate-spin" /> Loading datasets…
        </div>
      ) : datasets.length === 0 ? (
        <div className="rounded-lg border border-border-subtle p-8 text-center">
          <p className="text-sm text-text-secondary">No datasets imported yet.</p>
          <Link to="/app/data-import" className="btn btn-primary btn-sm mt-3">Go to data sources</Link>
        </div>
      ) : (
        <div className="space-y-2" role="group" aria-label="Datasets">
          {datasets.map((ds) => (
            <button
              key={ds.id}
              onClick={() =>
                setConfig((c) => (c.datasetId === ds.id ? c : { ...c, datasetId: ds.id, targetColumn: "", featureColumns: [] }))
              }
              aria-pressed={config.datasetId === ds.id}
              className={cn(choiceCard(config.datasetId === ds.id), "flex w-full items-center justify-between gap-3 p-4")}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">{ds.name}</p>
                <p className="mt-0.5 text-xs text-text-tertiary">
                  {plural(ds.latest_row_count ?? 0, "row")} · {plural(ds.version_count, "version")} · Added {formatDate(ds.created_at)}
                </p>
              </div>
              <span className="badge shrink-0">{ds.source_type}</span>
            </button>
          ))}
        </div>
      )}

      {previewLoading && (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <LoaderCircle size={16} className="animate-spin" /> Loading preview…
        </div>
      )}
      {error && <p className="rounded-lg border border-danger/30 bg-danger-muted p-3 text-sm text-danger">{error}</p>}

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ml-target" className="field-label">Target column</label>
              <select id="ml-target" className="input" value={config.targetColumn} onChange={(e) => setTarget(e.target.value)}>
                {data.columns.map((col) => (
                  <option key={col} value={col}>{col}{data.dataset_schema[col] ? ` (${data.dataset_schema[col]})` : ""}</option>
                ))}
              </select>
              <p className="field-hint">The value the model learns to predict.</p>
            </div>
            <fieldset>
              <legend className="field-label">Feature columns</legend>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border-subtle p-2">
                {data.columns.filter((col) => col !== config.targetColumn).map((col) => (
                  <label key={col} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-text hover:bg-surface-2">
                    <input type="checkbox" className="accent-primary" checked={config.featureColumns.includes(col)} onChange={() => toggleFeature(col)} />
                    <span className="truncate">{col}</span>
                  </label>
                ))}
              </div>
              <p className="field-hint">{plural(config.featureColumns.length, "column")} selected.</p>
            </fieldset>
          </div>

          <div className="overflow-hidden rounded-lg border border-border-subtle">
            <div className="flex items-center justify-between border-b border-border-subtle bg-surface-2 px-4 py-2.5">
              <span className="section-label">Preview</span>
              <span className="text-xs text-text-tertiary">First {plural(data.rows.length, "row")}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-2">
                    {data.columns.map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2 text-left font-medium text-text-tertiary">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border-subtle last:border-0">
                      {row.map((cell, j) => (
                        <td key={j} className="whitespace-nowrap px-4 py-1.5 font-mono text-text-secondary">
                          {cell == null ? "—" : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Parameters Step                                                    */
/* ------------------------------------------------------------------ */
function ParametersStep({ config, setConfig }: { config: TrainingConfig; setConfig: SetConfig }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text">Hyperparameters</h2>
        <p className="mt-1 text-sm text-text-secondary">Defaults are pre-filled. These settings shape the simulated run.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-5 rounded-lg border border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-text">Core parameters</h3>

          <div>
            <label htmlFor="ml-lr" className="field-label">Learning rate</label>
            <select
              id="ml-lr"
              className="input font-mono"
              value={config.learningRate}
              onChange={(e) => setConfig((c) => ({ ...c, learningRate: parseFloat(e.target.value) }))}
            >
              {LEARNING_RATES.map((lr) => (
                <option key={lr} value={lr}>{lr}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="ml-epochs" className="field-label mb-0">Epochs</label>
              <span className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-xs font-medium text-text">{config.epochs}</span>
            </div>
            <input id="ml-epochs" type="range" min={5} max={500} step={5} value={config.epochs}
              onChange={(e) => setConfig((c) => ({ ...c, epochs: parseInt(e.target.value) }))}
              className="w-full accent-primary" />
            <div className="flex justify-between text-xs text-text-tertiary"><span>5</span><span>500</span></div>
          </div>

          <div>
            <span className="field-label" id="ml-batch">Batch size</span>
            <div className="flex gap-1.5" role="group" aria-labelledby="ml-batch">
              {BATCH_SIZES.map((bs) => (
                <button key={bs} onClick={() => setConfig((c) => ({ ...c, batchSize: bs }))}
                  aria-pressed={config.batchSize === bs} className={chip(config.batchSize === bs)}>{bs}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5 rounded-lg border border-border-subtle p-5">
          <h3 className="text-sm font-semibold text-text">Advanced</h3>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="ml-split" className="field-label mb-0">Train / validation split</label>
              <span className="font-mono text-xs text-text-tertiary">{config.trainSplit}% / {100 - config.trainSplit}%</span>
            </div>
            <input id="ml-split" type="range" min={60} max={95} step={5} value={config.trainSplit}
              onChange={(e) => setConfig((c) => ({ ...c, trainSplit: parseInt(e.target.value) }))}
              className="w-full accent-primary" />
            <div className="flex">
              <div className="h-1.5 rounded-l-full bg-primary/50 transition-all" style={{ width: `${config.trainSplit}%` }} />
              <div className="h-1.5 rounded-r-full bg-surface-3 transition-all" style={{ width: `${100 - config.trainSplit}%` }} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="ml-decay" className="field-label mb-0">Weight decay</label>
              <span className="rounded-sm bg-surface-2 px-2 py-0.5 font-mono text-xs text-text">{config.weightDecay}</span>
            </div>
            <input id="ml-decay" type="range" min={0} max={0.5} step={0.01} value={config.weightDecay}
              onChange={(e) => setConfig((c) => ({ ...c, weightDecay: parseFloat(e.target.value) }))}
              className="w-full accent-primary" />
          </div>

          <div>
            <span className="field-label" id="ml-scheduler">Learning rate scheduler</span>
            <div className="flex gap-1.5" role="group" aria-labelledby="ml-scheduler">
              {SCHEDULERS.map((s) => (
                <button key={s} onClick={() => setConfig((c) => ({ ...c, scheduler: s }))}
                  aria-pressed={config.scheduler === s} className={cn(chip(config.scheduler === s), "capitalize")}>{s}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface-2 p-4">
        <p className="section-label mb-2">Configuration summary</p>
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Algorithm", value: config.algorithm },
            { label: "Learning rate", value: config.learningRate.toString() },
            { label: "Epochs", value: config.epochs.toString() },
            { label: "Batch size", value: config.batchSize.toString() },
            { label: "Split", value: `${config.trainSplit}%` },
            { label: "Scheduler", value: config.scheduler },
          ].map((item) => (
            <div key={item.label}>
              <span className="text-text-tertiary">{item.label}</span>
              <p className="mt-0.5 font-mono font-medium text-text">{item.value}</p>
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
const formatTime = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

function TrainStep({
  config,
  status,
  progress,
  epoch,
  metrics,
  logs,
  gpuUtil,
  memUtil,
  canStart,
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
  canStart: boolean;
  onStart: () => void;
  onStop: () => void;
  elapsedTime: number;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const isRunning = status === "training" || status === "preparing";
  const showResults = status === "training" || status === "completed" || (status === "stopped" && epoch > 0);
  const scoreLabel = config.problemType === "Classification" ? "Accuracy" : "R²";
  const latestMetric = metrics[metrics.length - 1];
  const lossData = metrics.map((m) => m.loss);
  const valLossData = metrics.map((m) => m.valLoss);
  const scoreData = metrics.map((m) => m.accuracy);
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  const heading =
    status === "idle" ? "Ready to train"
      : status === "preparing" ? "Preparing…"
        : status === "training" ? "Training in progress"
          : status === "completed" ? "Simulated run finished"
            : epoch > 0 ? `Stopped at epoch ${epoch}` : "Stopped before training started";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text">
            {heading} <span className="badge ml-1 bg-signal-muted text-signal">Simulated</span>
          </h2>
          <p className="mt-0.5 text-sm text-text-secondary">
            {config.modelName || "Untitled"} · {config.algorithm} · {plural(config.epochs, "epoch")}
          </p>
        </div>
        {isRunning ? (
          <button onClick={onStop} className="btn btn-danger"><Square size={14} /> Stop</button>
        ) : (
          <button onClick={onStart} disabled={!canStart} className="btn btn-primary">
            {status === "idle" ? <Play size={14} /> : <RotateCcw size={14} />}
            {status === "idle" ? "Start training" : "Run again"}
          </button>
        )}
      </div>

      {showResults && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-text-tertiary">
            <span>Epoch {epoch} / {config.epochs}</span>
            <span className="tabular">{progress.toFixed(1)}% · {formatTime(elapsedTime)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className={cn("h-full rounded-full transition-all duration-500 ease-out",
                status === "completed" ? "bg-success" : status === "stopped" ? "bg-warning" : "bg-primary")}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {showResults && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Loss", value: latestMetric?.loss.toFixed(4) ?? "—", color: "text-danger" },
            { label: "Validation loss", value: latestMetric?.valLoss.toFixed(4) ?? "—", color: "text-warning" },
            { label: scoreLabel, value: latestMetric ? pct(latestMetric.accuracy) : "—", color: "text-success" },
            { label: `Validation ${scoreLabel}`, value: latestMetric ? pct(latestMetric.valAccuracy) : "—", color: "text-info" },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-border-subtle p-3">
              <p className="text-xs font-medium text-text-tertiary">{m.label}</p>
              <p className={cn("mt-0.5 font-mono text-lg font-semibold", m.color)}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {showResults && metrics.length > 1 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border-subtle p-4">
            <SparklineChart data={lossData} className="text-danger" label="Training loss" currentValue={latestMetric?.loss.toFixed(4)} />
            {valLossData.length > 1 && (
              <div className="mt-3 border-t border-border-subtle pt-3">
                <SparklineChart data={valLossData} className="text-warning" height={70} label="Validation loss" currentValue={latestMetric?.valLoss.toFixed(4)} />
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border-subtle p-4">
            <SparklineChart data={scoreData} className="text-success" label={scoreLabel} currentValue={latestMetric ? pct(latestMetric.accuracy) : undefined} />
          </div>
        </div>
      )}

      {isRunning && (
        <div className="space-y-3 rounded-lg border border-border-subtle p-4">
          <p className="section-label">Resource use (simulated)</p>
          <ResourceBar label="GPU" value={gpuUtil} max={100} unit="%" />
          <ResourceBar label="Memory" value={memUtil} max={16} unit=" GB" />
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border-subtle">
        <div className="border-b border-border-subtle bg-surface-2 px-4 py-2">
          <span className="section-label">Log</span>
        </div>
        <div className="h-44 overflow-y-auto bg-surface-2 p-4 font-mono text-xs leading-relaxed" role="log" aria-live="off">
          {logs.length === 0 ? (
            <span className="text-text-tertiary">Waiting to start…</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={cn("mb-0.5", log.includes("✓") ? "text-success" : "text-text-secondary")}>{log}</div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {status === "completed" && latestMetric && (
        <div className="space-y-4 rounded-lg border border-border bg-surface-2 p-5">
          <div>
            <h3 className="text-base font-semibold text-text">Simulated run finished</h3>
            <p className="text-sm text-text-secondary">No model was trained or saved. These numbers come from a simulation, not from your data.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border-subtle bg-surface p-3">
              <p className="text-xs text-text-tertiary">Final {scoreLabel}</p>
              <p className="mt-0.5 font-mono text-xl font-semibold text-text">{pct(latestMetric.accuracy)}</p>
            </div>
            <div className="rounded-md border border-border-subtle bg-surface p-3">
              <p className="text-xs text-text-tertiary">Final loss</p>
              <p className="mt-0.5 font-mono text-xl font-semibold text-text">{latestMetric.loss.toFixed(4)}</p>
            </div>
            <div className="rounded-md border border-border-subtle bg-surface p-3">
              <p className="text-xs text-text-tertiary">Duration</p>
              <p className="mt-0.5 font-mono text-xl font-semibold text-text">{formatTime(elapsedTime)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */
export function MLTrainingPage() {
  const { datasets, loading: datasetsLoading } = useDatasets();
  const [currentStep, setCurrentStep] = useState<Step>("model");
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(new Set());
  const [config, setConfig] = useState<TrainingConfig>({
    modelName: "churn_model_v1",
    problemType: "Classification",
    algorithm: "XGBoost",
    learningRate: 0.01,
    epochs: 100,
    batchSize: 32,
    trainSplit: 80,
    weightDecay: 0.01,
    scheduler: "cosine",
    datasetId: "",
    targetColumn: "",
    featureColumns: [],
  });
  const [status, setStatus] = useState<TrainingStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [metrics, setMetrics] = useState<EpochMetric[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [gpuUtil, setGpuUtil] = useState(0);
  const [memUtil, setMemUtil] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  // Every timeout and interval of a run lives here, so Stop and unmount can cancel all of them.
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    // Timeout and interval ids share one pool in browsers, so either clear call works.
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString("en-SG", { hour12: false });
    setLogs((prev) => [...prev, `[simulated] ${ts}  ${msg}`]);
  }, []);

  const selectedDataset = datasets.find((ds) => ds.id === config.datasetId);
  const hasDataSelection = !!selectedDataset && !!config.targetColumn && config.featureColumns.length > 0;
  const isRunning = status === "training" || status === "preparing";

  const startTraining = useCallback(() => {
    if (isRunning || !selectedDataset) return;
    clearTimers();
    setStatus("preparing");
    setProgress(0);
    setEpoch(0);
    setMetrics([]);
    setLogs([]);
    setElapsedTime(0);

    addLog("Initialising simulated training run…");
    addLog(`  Model: ${config.modelName || "Untitled"}`);
    addLog(`  Algorithm: ${config.algorithm}`);
    addLog(`  Learning rate: ${config.learningRate}`);
    addLog(`  Epochs: ${config.epochs}`);
    addLog(`  Batch size: ${config.batchSize}`);

    const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));

    later(400, () => {
      addLog(`Dataset: ${selectedDataset.name} (${plural(selectedDataset.latest_row_count ?? 0, "row")})`);
      addLog(`  Target: ${config.targetColumn} · ${plural(config.featureColumns.length, "feature")}`);
    });

    later(800, () => {
      addLog(`  Train: ${config.trainSplit}% · Validation: ${100 - config.trainSplit}%`);
    });

    later(1500, () => {
      addLog("Starting training loop…");
      setStatus("training");

      timers.current.push(window.setInterval(() => setElapsedTime((prev) => prev + 1), 1000));

      let currentEpoch = 0;
      timers.current.push(window.setInterval(() => {
        currentEpoch += 1;
        const loss = 1.8 * Math.exp(-currentEpoch / 25) + 0.08 + Math.random() * 0.03;
        const valLoss = 1.8 * Math.exp(-currentEpoch / 28) + 0.12 + Math.random() * 0.04;
        const accuracy = 0.5 + 0.46 * (1 - Math.exp(-currentEpoch / 18)) + Math.random() * 0.015;
        const valAccuracy = 0.5 + 0.43 * (1 - Math.exp(-currentEpoch / 22)) + Math.random() * 0.02;
        const lr = config.scheduler === "cosine"
          ? config.learningRate * 0.5 * (1 + Math.cos(Math.PI * currentEpoch / config.epochs))
          : config.scheduler === "linear"
            ? config.learningRate * (1 - currentEpoch / config.epochs)
            : config.learningRate;

        setProgress((currentEpoch / config.epochs) * 100);
        setEpoch(currentEpoch);
        setMetrics((prev) => [...prev, { epoch: currentEpoch, loss, valLoss, accuracy, valAccuracy, lr }]);
        setGpuUtil(65 + Math.random() * 30);
        setMemUtil(8 + Math.random() * 5);

        if (currentEpoch % 5 === 0 || currentEpoch === 1) {
          addLog(`  Epoch ${String(currentEpoch).padStart(3, " ")}/${config.epochs}  loss ${loss.toFixed(4)}  val_loss ${valLoss.toFixed(4)}  acc ${(accuracy * 100).toFixed(1)}%  lr ${lr.toFixed(6)}`);
        }

        if (currentEpoch >= config.epochs) {
          clearTimers();
          addLog("✓ Simulated run finished. Nothing was trained or saved.");
          setStatus("completed");
          setProgress(100);
          setGpuUtil(0);
          setMemUtil(0);
        }
      }, 150));
    });
  }, [config, isRunning, selectedDataset, addLog, clearTimers]);

  const stopTraining = useCallback(() => {
    clearTimers();
    setStatus("stopped");
    setGpuUtil(0);
    setMemUtil(0);
    addLog(epoch > 0 ? `Stopped by user at epoch ${epoch}` : "Stopped by user before training started");
  }, [addLog, clearTimers, epoch]);

  const stepIndex = STEPS.findIndex((s) => s.key === currentStep);
  const isLastStep = stepIndex === STEPS.length - 1;
  const canContinue = currentStep !== "dataset" || hasDataSelection;

  const handleNext = () => {
    if (isLastStep || !canContinue) return;
    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    setCurrentStep(STEPS[stepIndex + 1].key);
  };

  const handleBack = () => {
    if (stepIndex > 0) setCurrentStep(STEPS[stepIndex - 1].key);
  };

  const statusLabel: Record<TrainingStatus, string> = {
    idle: "Ready", preparing: "Preparing", training: "Training", completed: "Finished (simulated)", stopped: "Stopped",
  };

  return (
    <section>
      <PageHeader
        title="Model training"
        subtitle="Configure a training run and watch a simulated one."
      />
      <PreviewNotice />

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="space-y-4">
          <div className="card p-3">
            <StepIndicator steps={STEPS} currentStep={currentStep} completedSteps={completedSteps} onStepClick={setCurrentStep} />
          </div>
          <div className="card space-y-2 p-3">
            <p className="section-label px-1">Summary</p>
            <div className="space-y-1.5 px-1 text-xs">
              {[
                { label: "Algorithm", value: config.algorithm },
                { label: "Problem", value: config.problemType },
                { label: "Dataset", value: selectedDataset?.name ?? "—" },
                { label: "Target", value: config.targetColumn || "—" },
                { label: "Epochs", value: config.epochs },
                { label: "Status", value: statusLabel[status] },
              ].map((item) => (
                <div key={item.label} className="flex justify-between gap-3">
                  <span className="text-text-tertiary">{item.label}</span>
                  <span className={cn("truncate font-medium", item.label === "Status" && status === "completed" ? "text-success" : "text-text")}>
                    {typeof item.value === "number" ? formatCount(item.value) : item.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card p-6">
            {currentStep === "model" && <ModelStep config={config} setConfig={setConfig} />}
            {currentStep === "dataset" && (
              <DatasetStep config={config} setConfig={setConfig} datasets={datasets} datasetsLoading={datasetsLoading} />
            )}
            {currentStep === "parameters" && <ParametersStep config={config} setConfig={setConfig} />}
            {currentStep === "train" && (
              <TrainStep config={config} status={status} progress={progress} epoch={epoch}
                metrics={metrics} logs={logs} gpuUtil={gpuUtil} memUtil={memUtil}
                canStart={hasDataSelection} onStart={startTraining} onStop={stopTraining} elapsedTime={elapsedTime} />
            )}
          </div>
          <div className="flex items-center justify-between">
            <button onClick={handleBack} disabled={stepIndex === 0 || isRunning} className="btn btn-secondary">
              <ArrowLeft size={15} /> Back
            </button>
            <span className="text-xs text-text-tertiary">Step {stepIndex + 1} of {STEPS.length}</span>
            {isLastStep ? (
              <span />
            ) : (
              <button
                onClick={handleNext}
                disabled={!canContinue}
                title={canContinue ? undefined : "Choose a dataset, a target column and at least one feature column"}
                className="btn btn-primary"
              >
                {stepIndex === STEPS.length - 2 ? "Go to training" : "Continue"} <ArrowRight size={15} />
              </button>
            )}
          </div>
          {!hasDataSelection && isLastStep && (
            <p className="text-sm text-warning">Choose a dataset, target and features in the Dataset step before training.</p>
          )}
        </div>
      </div>
    </section>
  );
}
