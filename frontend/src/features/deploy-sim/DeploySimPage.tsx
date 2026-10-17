import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../../components/shared/PageHeader";
import { deployments } from "../../lib/mocks/data";

interface Scenario {
  id: string;
  name: string;
  params: {
    accountBalance: number;
    supportTickets: number;
    discountOffered: number;
    tenure: number;
    engagementScore: number;
  };
  prediction: number;
  createdAt: string;
}

interface EndpointConfig {
  id: string;
  name: string;
  baseUrl: string;
  strategy: "canary" | "shadow" | "blue-green";
  trafficPercent: number;
  autoScale: boolean;
  maxLatency: number;
}

const defaultScenario: Scenario = {
  id: "current",
  name: "Current State",
  params: {
    accountBalance: 11000,
    supportTickets: 5,
    discountOffered: 12,
    tenure: 24,
    engagementScore: 65
  },
  prediction: 78,
  createdAt: new Date().toISOString()
};

const endpointConfigs: EndpointConfig[] = [
  {
    id: "ep-1",
    name: "XGBoost Churn v1.2",
    baseUrl: "https://api.example.com/v1/predict",
    strategy: "canary",
    trafficPercent: 100,
    autoScale: true,
    maxLatency: 150
  },
  {
    id: "ep-2",
    name: "Random Forest v1.0",
    baseUrl: "https://api.example.com/v2/predict",
    strategy: "shadow",
    trafficPercent: 0,
    autoScale: false,
    maxLatency: 200
  }
];

function calculatePrediction(params: Scenario["params"]): number {
  const balanceScore = Math.max(0, 100 - (params.accountBalance / 200));
  const ticketScore = Math.min(100, params.supportTickets * 12);
  const discountScore = Math.max(0, 50 - params.discountOffered * 1.5);
  const tenureScore = Math.max(0, 20 - params.tenure * 0.3);
  const engagementScore = Math.max(0, 100 - params.engagementScore);
  
  const rawScore = (
    balanceScore * 0.15 +
    ticketScore * 0.35 +
    discountScore * 0.25 +
    tenureScore * 0.15 +
    engagementScore * 0.1
  );
  
  return Math.min(95, Math.max(5, rawScore));
}

function cn(...classes: (string | boolean | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

function SliderWithNumber({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  onChange,
  colorClass
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  colorClass: string;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  
  return (
    <div className="group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-secondary">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${colorClass}`}>
          {unit === "$" ? `${unit}${value.toLocaleString()}` : `${value}${unit}`}
        </span>
      </div>
      <div className="relative">
        <div className="absolute inset-0 h-1.5 rounded-full bg-border-subtle" />
        <div 
          className={`absolute h-1.5 rounded-full ${colorClass.replace('text-', 'bg-')}`}
          style={{ width: `${percentage}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="relative w-full h-1.5 cursor-pointer appearance-none bg-transparent focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent/20"
          style={{ 
            background: `linear-gradient(to right, var(--${colorClass.replace('text-', '')}), var(--${colorClass.replace('text-', '')})) ${percentage}% / 100% no-repeat`
          }}
        />
      </div>
    </div>
  );
}

function PredictionGauge({ value, size = "md" }: { value: number; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "w-20 h-20",
    md: "w-32 h-32",
    lg: "w-40 h-40"
  };
  
  const textSize = {
    sm: "text-2xl",
    md: "text-4xl",
    lg: "text-5xl"
  };
  
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (value / 100) * circumference;
  const colorClass = value < 30 ? "text-success" : value < 60 ? "text-warning" : "text-danger";
  
  return (
    <div className={cn("relative flex items-center justify-center", sizeClasses[size])}>
      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          className="text-border-subtle"
        />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className={cn("transition-all duration-700 ease-out", colorClass)}
        />
      </svg>
      <div className="flex flex-col items-center">
        <span className={cn("font-bold tracking-tight tabular-nums", textSize[size], colorClass)}>
          {Math.round(value)}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-wider text-secondary">Risk</span>
      </div>
    </div>
  );
}

function ScenarioCard({
  scenario,
  isActive,
  onSelect
}: {
  scenario: Scenario;
  isActive: boolean;
  onSelect: () => void;
}) {
  const riskColorClass = scenario.prediction < 30 ? "text-success" : scenario.prediction < 60 ? "text-warning" : "text-danger";
  
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-all",
        isActive 
          ? "border-accent bg-accent/5 shadow-md" 
          : "card card-hover"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text truncate">{scenario.name}</span>
        <span className={cn("text-sm font-bold tabular-nums", riskColorClass)}>
          {Math.round(scenario.prediction)}%
        </span>
      </div>
      <div className="flex gap-3 text-[10px] text-secondary">
        <span>${scenario.params.accountBalance.toLocaleString()}</span>
        <span>•</span>
        <span>{scenario.params.supportTickets} tickets</span>
        <span>•</span>
        <span>{scenario.params.discountOffered}% disc.</span>
      </div>
    </button>
  );
}

function EndpointCard({
  config,
  deployment
}: {
  config: EndpointConfig;
  deployment: { latencyMs: number; expectedLift: number };
}) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="rounded-lg border border-subtle bg-surface overflow-hidden transition-all hover:border-border">
      <div 
        className="flex items-center justify-between p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <div>
            <p className="text-sm font-semibold text">{config.name}</p>
            <p className="text-[11px] text-secondary">{config.baseUrl}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-semibold tabular-nums text">{deployment.latencyMs}ms</p>
            <p className="text-[10px] text-secondary">latency</p>
          </div>
          <span className={cn(
            "px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md",
            config.strategy === "canary" && "bg-success/10 text-success",
            config.strategy === "shadow" && "bg-warning/10 text-warning",
            config.strategy === "blue-green" && "bg-info/10 text-info"
          )}>
            {config.strategy}
          </span>
          <svg 
            className={cn("w-4 h-4 text-secondary transition-transform", expanded && "rotate-180")} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      
      <div className={cn("grid gap-4 px-4 pb-4 transition-all", expanded ? "grid-cols-2" : "hidden")}>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wider text-secondary">Traffic Split</label>
          <div className="mt-1 flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-border-subtle overflow-hidden">
              <div 
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${config.trafficPercent}%` }}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums">{config.trafficPercent}%</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-medium uppercase tracking-wider text-secondary">Expected Lift</p>
          <p className="text-lg font-bold tabular-nums text-success">+{deployment.expectedLift}%</p>
        </div>
      </div>
    </div>
  );
}

function LiveMetric({
  label,
  value,
  change,
  unit
}: {
  label: string;
  value: string | number;
  change?: number;
  unit?: string;
}) {
  const isPositive = change && change > 0;
  
  return (
    <div className="text-center">
      <p className="text-[10px] font-medium uppercase tracking-wider text-secondary mb-1">{label}</p>
      <p className="text-xl font-bold tracking-tight text tabular-nums">
        {value}{unit && <span className="text-sm font-normal text-secondary">{unit}</span>}
      </p>
      {change !== undefined && (
        <p className={cn(
          "text-[10px] font-medium tabular-nums mt-1",
          isPositive ? "text-danger" : "text-success"
        )}>
          {isPositive ? "+" : ""}{change}%
        </p>
      )}
    </div>
  );
}

export function DeploySimPage() {
  const [currentParams, setCurrentParams] = useState(defaultScenario.params);
  const [prediction, setPrediction] = useState(defaultScenario.prediction);
  const [scenarios, setScenarios] = useState<Scenario[]>([defaultScenario]);
  const [activeScenarioId, setActiveScenarioId] = useState("current");
  const [scenarioName, setScenarioName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batchStatus, setBatchStatus] = useState<"idle" | "processing" | "complete">("idle");
  const [processingProgress, setProcessingProgress] = useState(0);
  
  useEffect(() => {
    const newPrediction = calculatePrediction(currentParams);
    setPrediction(newPrediction);
  }, [currentParams]);
  
  const handleParamChange = useCallback((key: keyof Scenario["params"], value: number) => {
    setCurrentParams(prev => ({ ...prev, [key]: value }));
    setActiveScenarioId("current");
  }, []);
  
  const handleSaveScenario = useCallback(() => {
    if (!scenarioName.trim()) return;
    
    const newScenario: Scenario = {
      id: `sc-${Date.now()}`,
      name: scenarioName,
      params: { ...currentParams },
      prediction,
      createdAt: new Date().toISOString()
    };
    
    setScenarios(prev => [...prev, newScenario]);
    setScenarioName("");
    setShowSaveInput(false);
  }, [scenarioName, currentParams, prediction]);
  
  const handleLoadScenario = useCallback((scenario: Scenario) => {
    setCurrentParams(scenario.params);
    setActiveScenarioId(scenario.id);
  }, []);
  
  const handleExportBatch = useCallback(() => {
    setBatchStatus("processing");
    setProcessingProgress(0);
    
    const interval = setInterval(() => {
      setProcessingProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setBatchStatus("complete");
          return 100;
        }
        return prev + 10;
      });
    }, 300);
  }, []);
  
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setBatchFile(file);
  }, []);
  
  const previousPrediction = scenarios.find(s => s.id === activeScenarioId)?.prediction ?? prediction;
  const predictionChange = prediction - previousPrediction;
  
  return (
    <section className="space-y-6">
      <PageHeader
        title="What-If Simulator"
        subtitle="Simulate outcomes, manage endpoints, and run batch predictions with your deployed models."
      />
      
      <div className="grid gap-6 xl:grid-cols-12">
        <article className="card xl:col-span-5 flex flex-col overflow-hidden">
          <div className="border-b border-subtle bg-linear-to-r from-accent/5 to-transparent px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text">Parameter Controls</h2>
                <p className="mt-1 text-[11px] uppercase tracking-wider text-secondary">Adjust inputs to simulate outcomes</p>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-medium text-secondary">
                <span className="w-2 h-2 rounded-full bg-info animate-pulse" />
                Live Prediction
              </div>
            </div>
          </div>
          
          <div className="p-5 flex-1 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <SliderWithNumber
                label="Account Balance"
                value={currentParams.accountBalance}
                min={1000}
                max={50000}
                step={500}
                unit="$"
                onChange={(v) => handleParamChange("accountBalance", v)}
                colorClass="text-accent"
              />
              <SliderWithNumber
                label="Support Tickets"
                value={currentParams.supportTickets}
                min={0}
                max={20}
                step={1}
                unit=""
                onChange={(v) => handleParamChange("supportTickets", v)}
                colorClass="text-danger"
              />
              <SliderWithNumber
                label="Discount Offered"
                value={currentParams.discountOffered}
                min={0}
                max={50}
                step={1}
                unit="%"
                onChange={(v) => handleParamChange("discountOffered", v)}
                colorClass="text-warning"
              />
              <SliderWithNumber
                label="Tenure (months)"
                value={currentParams.tenure}
                min={1}
                max={60}
                step={1}
                unit=""
                onChange={(v) => handleParamChange("tenure", v)}
                colorClass="text-success"
              />
              <SliderWithNumber
                label="Engagement Score"
                value={currentParams.engagementScore}
                min={0}
                max={100}
                step={1}
                unit=""
                onChange={(v) => handleParamChange("engagementScore", v)}
                colorClass="text-info"
              />
            </div>
            
            <div className="flex items-center justify-between pt-4 border-t border-subtle">
              <button
                onClick={() => {
                  setCurrentParams({
                    accountBalance: 11000,
                    supportTickets: 5,
                    discountOffered: 12,
                    tenure: 24,
                    engagementScore: 65
                  });
                }}
                className="btn-ghost text-xs font-medium"
              >
                Reset to Default
              </button>
              <button
                onClick={() => setShowSaveInput(true)}
                className="btn-ghost text-xs font-medium text-accent"
              >
                + Save Scenario
              </button>
            </div>
          </div>
        </article>
        
        <article className="card xl:col-span-3 flex flex-col overflow-hidden">
          <div className="border-b border-subtle bg-linear-to-b from-accent/5 to-transparent px-5 py-4">
            <h2 className="text-base font-semibold text">Prediction</h2>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-secondary">Real-time risk assessment</p>
          </div>
          
          <div className="flex-1 flex flex-col items-center justify-center p-6">
            <PredictionGauge value={prediction} size="lg" />
            
            <div className={cn(
              "mt-4 px-3 py-1.5 rounded-full text-xs font-semibold",
              prediction < 30 && "bg-success/10 text-success",
              prediction >= 30 && prediction < 60 && "bg-warning/10 text-warning",
              prediction >= 60 && "bg-danger/10 text-danger"
            )}>
              {prediction < 30 ? "Low Risk" : prediction < 60 ? "Medium Risk" : "High Risk"}
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4 px-5 py-4 border-t border-subtle bg-surface-2">
            <LiveMetric label="Change" value={predictionChange > 0 ? `+${predictionChange.toFixed(1)}` : predictionChange.toFixed(1)} unit="%" />
            <LiveMetric label="Confidence" value="94.2" unit="%" />
            <LiveMetric label="Model" value="XGBoost" />
          </div>
        </article>
        
        <article className="card xl:col-span-4 flex flex-col overflow-hidden">
          <div className="border-b border-subtle bg-linear-to-l from-accent/5 to-transparent px-5 py-4">
            <h2 className="text-base font-semibold text">Saved Scenarios</h2>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-secondary">Compare and select saved state</p>
          </div>
          
          <div className="flex-1 p-4 space-y-2 overflow-y-auto max-h-[400px]">
            {showSaveInput && (
              <div className="mb-4 p-3 rounded-lg bg-surface-2 border border-subtle">
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  placeholder="Scenario name..."
                  className="input w-full text-sm"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleSaveScenario()}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleSaveScenario}
                    className="btn-primary flex-1 rounded-md px-3 py-1.5 text-xs font-semibold"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setShowSaveInput(false);
                      setScenarioName("");
                    }}
                    className="btn-secondary rounded-md px-3 py-1.5 text-xs font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            
            {scenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                isActive={scenario.id === activeScenarioId}
                onSelect={() => handleLoadScenario(scenario)}
              />
            ))}
          </div>
          
          <div className="border-t border-subtle px-5 py-4 bg-surface-2">
            <button
              onClick={handleExportBatch}
              disabled={batchStatus === "processing"}
              className={cn(
                "w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
                batchStatus === "processing"
                  ? "bg-surface-3 text-secondary cursor-not-allowed"
                  : "btn-primary"
              )}
            >
              {batchStatus === "processing" ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing... {processingProgress}%
                </span>
              ) : batchStatus === "complete" ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Export Complete
                </span>
              ) : (
                "Export Batch Predictions"
              )}
            </button>
          </div>
        </article>
      </div>
      
      <div className="grid gap-6 lg:grid-cols-2">
        <article className="card flex flex-col overflow-hidden">
          <div className="border-b border-subtle bg-linear-to-r from-success/5 to-transparent px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text">Active Endpoints</h2>
                <p className="mt-1 text-[11px] uppercase tracking-wider text-secondary">Production & Staging APIs</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
                </span>
                <span className="text-xs font-medium text-success">2 Active</span>
              </div>
            </div>
          </div>
          
          <div className="p-4 space-y-3">
            {endpointConfigs.map((config, i) => (
              <EndpointCard
                key={config.id}
                config={config}
                deployment={deployments[i]}
              />
            ))}
          </div>
          
          <div className="border-t border-subtle px-5 py-4 bg-surface-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text">Primary API Endpoint</p>
                <p className="text-[11px] text-secondary">https://api.example.com/v1/predict</p>
              </div>
              <button className="btn-ghost text-xs font-medium text-accent">
                View Docs →
              </button>
            </div>
          </div>
        </article>
        
        <article className="card flex flex-col overflow-hidden">
          <div className="border-b border-subtle bg-linear-to-r from-info/5 to-transparent px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text">Batch Scoring</h2>
                <p className="mt-1 text-[11px] uppercase tracking-wider text-secondary">Upload CSV for bulk predictions</p>
              </div>
              <span className="bg-info/10 text-info px-2.5 py-1 text-[10px] font-semibold rounded-full">
                Ready
              </span>
            </div>
          </div>
          
          <div className="p-5">
            <div className="rounded-lg border-2 border-dashed border-subtle bg-surface-2 p-8 text-center transition-colors hover:border-accent/40">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
                id="batch-upload"
              />
              <label htmlFor="batch-upload" className="cursor-pointer">
                {batchFile ? (
                  <div className="flex flex-col items-center">
                    <svg className="w-10 h-10 text-success mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm font-medium text">{batchFile.name}</p>
                    <p className="text-[11px] text-secondary mt-1">{(batchFile.size / 1024).toFixed(1)} KB</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center">
                    <svg className="w-10 h-10 text-secondary mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm font-medium text">Drop CSV file here</p>
                    <p className="text-[11px] text-secondary mt-1">or click to browse</p>
                  </div>
                )}
              </label>
            </div>
            
            <div className="mt-4 flex gap-3">
              <button
                disabled={!batchFile || batchStatus === "processing"}
                className={cn(
                  "flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all",
                  !batchFile || batchStatus === "processing"
                    ? "bg-surface-3 text-secondary cursor-not-allowed"
                    : "btn-primary"
                )}
              >
                Run Batch Score
              </button>
              <button
                disabled={!batchFile}
                className={cn(
                  "rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors",
                  !batchFile
                    ? "text-secondary cursor-not-allowed"
                    : "btn-secondary"
                )}
              >
                Download Template
              </button>
            </div>
            
            <div className="mt-4 pt-4 border-t border-subtle">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-secondary">Last Run</p>
                  <p className="text-sm font-semibold text mt-1">2 hours ago</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-secondary">Records</p>
                  <p className="text-sm font-semibold text mt-1">184,200</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-secondary">Status</p>
                  <p className="text-sm font-semibold text-success mt-1">Completed</p>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}