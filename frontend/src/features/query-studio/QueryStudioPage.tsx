import { useState, useRef, useEffect, useCallback } from "react";
import { PageHeader } from "../../components/shared/PageHeader";
import { useDatasets, useQueryApi, type QueryResult } from "../../lib/hooks/useDatasets";
import { cn } from "../../lib/cn";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  result?: QueryResult;
  error?: string;
  rowCount?: number;
}

const SQL_SUGGESTIONS = [
  "SELECT * FROM dataset LIMIT 20",
  "SELECT COUNT(*) AS rows FROM dataset",
  "SELECT * FROM dataset ORDER BY 1 DESC LIMIT 10",
];

function ResultTable({ result }: { result: QueryResult }) {
  if (result.rows.length === 0) {
    return <p className="text-xs text-text-tertiary mt-3">Query returned no rows.</p>;
  }
  return (
    <div className="mt-4 rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto max-h-80">
        <table className="w-full text-xs">
          <thead className="sticky top-0">
            <tr className="bg-surface-2 border-b border-border">
              {result.columns.map((c) => (
                <th key={c} className="text-left px-3 py-2 font-bold text-text-secondary whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, i) => (
              <tr key={i} className="border-b border-border-subtle last:border-0 hover:bg-surface-2/50">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 font-mono text-text whitespace-nowrap">
                    {cell === null || cell === undefined ? <span className="text-text-tertiary italic">null</span> : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function QueryStudioPage() {
  const { datasets, loading: datasetsLoading } = useDatasets();
  const { execute } = useQueryApi();

  const [selectedDatasetId, setSelectedDatasetId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content: "Connected. Write a SQL query against the `dataset` view — it always points at the latest version of the selected dataset.",
      timestamp: "—",
    },
  ]);
  const [input, setInput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedDatasetId && datasets.length > 0) setSelectedDatasetId(datasets[0].id);
  }, [datasets, selectedDatasetId]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRunning]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || !selectedDatasetId) return;

    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text, timestamp: now };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsRunning(true);

    try {
      const result = await execute(selectedDatasetId, text);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Returned ${result.rows.length} row${result.rows.length === 1 ? "" : "s"} · ${result.columns.length} column${result.columns.length === 1 ? "" : "s"}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        result,
        rowCount: result.rows.length,
      }]);
    } catch (e: any) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Query failed.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        error: e.message,
      }]);
    } finally {
      setIsRunning(false);
    }
  }, [execute, selectedDatasetId]);

  return (
    <div className="flex flex-col h-[calc(100vh-var(--header-h))] overflow-hidden animate-in fade-in duration-500">
      <PageHeader
        title="Query Studio"
        subtitle="Run read-only SQL against the latest version of your datasets, powered by DuckDB."
        actions={
          <div className="relative flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-2 border border-subtle text-xs">
            <svg className="w-4 h-4 text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79 8-4" />
            </svg>
            <select
              className="bg-transparent border-none outline-hidden appearance-none pr-5 cursor-pointer text font-medium"
              value={selectedDatasetId}
              onChange={(e) => setSelectedDatasetId(e.target.value)}
              disabled={datasetsLoading || datasets.length === 0}
            >
              {datasets.length === 0 && <option value="">No datasets</option>}
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        }
      />

      <div className="flex-1 flex flex-col min-h-0 bg-surface-2/20">
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto space-y-8 pb-40">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex flex-col gap-2", msg.role === "user" ? "items-end" : "items-start")}>
                <div className={cn(
                  "max-w-[90%] rounded-2xl p-5 text-sm leading-relaxed shadow-xs",
                  msg.role === "user" ? "bg-primary text-white font-mono" : "bg-surface border border-border text w-full"
                )}>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.error && (
                    <div className="mt-3 rounded-lg bg-danger/5 border border-danger/20 p-3 text-xs font-mono text-danger">{msg.error}</div>
                  )}
                  {msg.result && <ResultTable result={msg.result} />}
                </div>
                <span className="text-[10px] font-bold text-text-tertiary uppercase tracking-widest px-2">{msg.timestamp}</span>
              </div>
            ))}

            {isRunning && (
              <div className="flex items-center gap-3 text-text-tertiary">
                <div className="size-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                <span className="text-xs font-bold uppercase tracking-widest">Running query…</span>
              </div>
            )}
            <div ref={scrollRef} />
          </div>
        </div>

        <div className="absolute bottom-8 inset-x-0 mx-auto max-w-3xl px-6">
          <div className="flex flex-col gap-4">
            {messages.length < 3 && !isRunning && (
              <div className="flex flex-wrap gap-2 justify-center">
                {SQL_SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => setInput(s)}
                    className="px-4 py-2 rounded-full border border-border bg-white/60 backdrop-blur-md text-xs font-mono hover:border-primary hover:text-primary transition-all shadow-xs">
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="card shadow-2xl shadow-primary/10 border-primary/10 overflow-hidden bg-white/80 backdrop-blur-xl">
              <div className="flex items-center px-6 py-1">
                <span className="font-mono text-xs font-bold text-text-tertiary mr-3">SQL</span>
                <input
                  type="text"
                  autoFocus
                  placeholder={selectedDatasetId ? "SELECT * FROM dataset LIMIT 20" : "Select a dataset to begin…"}
                  className="flex-1 bg-transparent border-none outline-hidden text-sm font-mono py-5 placeholder:text-text-tertiary"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSend(input)}
                  disabled={isRunning || !selectedDatasetId}
                />
                <button
                  onClick={() => handleSend(input)}
                  disabled={!input.trim() || isRunning || !selectedDatasetId}
                  className={cn("size-10 rounded-xl flex items-center justify-center transition-all",
                    input.trim() && selectedDatasetId ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-surface-2 text-text-tertiary"
                  )}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                </button>
              </div>
              <div className="px-6 py-2 bg-surface-2/30 border-t border-border-subtle flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary">Read-only · single SELECT · max 1000 rows</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-tertiary opacity-40">DuckDB Engine</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
