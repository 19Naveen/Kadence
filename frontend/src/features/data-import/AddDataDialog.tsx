import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight, Database, FileSpreadsheet, LoaderCircle, Plus, Upload, X } from "lucide-react";
import { Dialog } from "../../components/shared/Dialog";
import { cn } from "../../lib/cn";
import type { DatasetSummary } from "../../lib/hooks/useDatasets";
import {
  commitJob, createDbJob, fileSourceType, isFileSource, uploadFile, waitForJob, type DbSourceType,
} from "../../lib/api/ingest";
import { formatBytes, plural } from "../../lib/format";
import type { StudioLaunch } from "../data-transform/launch";
import { ACCEPTED_FILES, DB_SOURCES, SOURCE_LABEL, joinLaunch, stripExt } from "./sources";

type Source = "files" | DbSourceType;
type FileStatus = "waiting" | "uploading" | "importing" | "done" | "error";

export interface AddDataStart {
  files?: File[];
  source?: Source;
  /** Dataset the import becomes a new version of. */
  target?: DatasetSummary;
}

const STATUS_TEXT: Record<FileStatus, string> = {
  waiting: "Waiting", uploading: "Uploading…", importing: "Importing…", done: "Imported", error: "Failed",
};

const portFor = (t: DbSourceType) => DB_SOURCES.find((s) => s.type === t)!.port;
const DEFAULT_PORTS = DB_SOURCES.map((s) => s.port);

function splitSupported(list: File[]) {
  const ok = list.filter((f) => fileSourceType(f.name));
  const bad = list.filter((f) => !fileSourceType(f.name));
  const error = bad.length
    ? `${bad.map((f) => f.name).join(", ")} ${bad.length === 1 ? "isn't a supported file" : "aren't supported files"}. Use CSV, Excel (.xlsx) or Parquet.`
    : "";
  return { ok, error };
}

export function AddDataDialog({
  start, datasets, workspaceId, authHeaders, onClose, onLaunch, onImported,
}: {
  start: AddDataStart;
  datasets: DatasetSummary[];
  workspaceId: string;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onLaunch: (launch: StudioLaunch) => void;
  onImported: (message: string) => void;
}) {
  const target = start.target ?? null;
  const initial = splitSupported(start.files ?? []);
  const initialSource: Source | null = initial.ok.length ? "files" : start.source ?? null;
  const initialDb: DbSourceType = initialSource && initialSource !== "files" ? initialSource : "postgres";

  const [step, setStep] = useState<"source" | "details">(initialSource ? "details" : "source");
  const [source, setSource] = useState<Source | null>(initialSource);
  const [files, setFiles] = useState<File[]>(target ? initial.ok.slice(0, 1) : initial.ok);
  const [names, setNames] = useState<string[]>(initial.ok.map((f) => stripExt(f.name)));
  const [status, setStatus] = useState<FileStatus[]>([]);
  const [error, setError] = useState(initial.error);
  const [busy, setBusy] = useState(false);

  const fileDatasets = datasets.filter((d) => isFileSource(d.source_type) && d.version_count > 0);
  const [destination, setDestination] = useState<"new" | "existing">(target ? "existing" : "new");
  const [existingId, setExistingId] = useState(target?.id ?? fileDatasets[0]?.id ?? "");
  const [joinAfter, setJoinAfter] = useState(false);

  const [db, setDb] = useState<DbSourceType>(initialDb);
  const [form, setForm] = useState({ host: "", port: portFor(initialDb), database: "", table: "", user: "", password: "", name: "" });

  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const firstStep = useRef(true);
  const imported = useRef<string[]>([]);

  useEffect(() => () => abort.current?.abort(), []);

  // Move focus into the new step (the Dialog only focuses on open).
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    bodyRef.current?.querySelector<HTMLElement>("input:not([type=file]), select, button")?.focus();
  }, [step]);

  function addFiles(list: File[]) {
    const { ok, error } = splitSupported(list);
    setError(error);
    if (!ok.length) return;
    const next = target ? ok.slice(0, 1) : [...files, ...ok];
    setFiles(next);
    setNames((n) => (target ? next.map((f) => stripExt(f.name)) : [...n, ...ok.map((f) => stripExt(f.name))]));
    setSource("files");
    setStep("details");
  }

  function removeFile(i: number) {
    setFiles((f) => f.filter((_, j) => j !== i));
    setNames((n) => n.filter((_, j) => j !== i));
    if (files.length === 1) setStep("source");
  }

  function chooseDb(t: DbSourceType) {
    // Swap the port only if the user hasn't typed their own.
    setForm((f) => ({ ...f, port: !f.port || DEFAULT_PORTS.includes(f.port) ? portFor(t) : f.port }));
    setDb(t);
    setSource(t);
    setError("");
    setStep("details");
  }

  async function reviewFile() {
    setBusy(true);
    setError("");
    try {
      const existing = destination === "existing" ? fileDatasets.find((d) => d.id === existingId) ?? target : null;
      const datasetName = existing?.name ?? (names[0].trim() || stripExt(files[0].name));
      const job = await uploadFile(authHeaders, { workspaceId, file: files[0], datasetId: existing?.id, datasetName });
      onLaunch({ mode: "import", jobId: job.id, datasetId: job.dataset_id, datasetName });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  /** Several files: import each as-is, then optionally open the first two joined. */
  async function importAll() {
    setBusy(true);
    setError("");
    abort.current = new AbortController();
    // On a retry, files that already imported are kept rather than uploaded twice.
    const created = imported.current;
    let current = 0;
    setStatus(files.map((_, i) => (created[i] ? "done" : "waiting")));
    const mark = (i: number, s: FileStatus) => setStatus((p) => p.map((v, j) => (j === i ? s : v)));
    try {
      for (current = 0; current < files.length; current++) {
        if (created[current]) continue;
        mark(current, "uploading");
        const job = await uploadFile(authHeaders, { workspaceId, file: files[current], datasetName: names[current].trim() || stripExt(files[current].name) });
        mark(current, "importing");
        await commitJob(authHeaders, job.id, []);
        await waitForJob(authHeaders, job.id, abort.current.signal);
        mark(current, "done");
        created[current] = job.dataset_id;
      }
      if (joinAfter) onLaunch(await joinLaunch(authHeaders, created[0], created[1]));
      else onImported(`Imported ${plural(created.length, "dataset")}.`);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (current < files.length) mark(current, "error");
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function reviewDb(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const port = Number(form.port);
      if (!Number.isInteger(port) || port <= 0) throw new Error("Port must be a whole number.");
      const table = form.table.trim();
      const datasetName = target?.name ?? (form.name.trim() || table.split(".").pop() || table);
      const job = await createDbJob(authHeaders, {
        workspaceId, sourceType: db, datasetId: target?.id, datasetName,
        config: { host: form.host.trim(), port, database: form.database.trim(), user: form.user.trim(), password: form.password, table },
      });
      onLaunch({ mode: "import", jobId: job.id, datasetId: job.dataset_id, datasetName });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const isFiles = step === "details" && source === "files";
  const isDb = step === "details" && source !== null && source !== "files";
  const single = files.length === 1;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  let primary: ReactNode = null;
  if (isFiles && single) {
    primary = (
      <button className="btn btn-primary" onClick={reviewFile} disabled={busy || (destination === "existing" && !existingId)}>
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} />} Continue to review
      </button>
    );
  } else if (isFiles) {
    primary = (
      <button className="btn btn-primary" onClick={importAll} disabled={busy}>
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Upload size={15} />}
        {joinAfter ? "Import and join" : `Import ${files.length} files`}
      </button>
    );
  } else if (isDb) {
    primary = (
      <button className="btn btn-primary" type="submit" form="add-data-db" disabled={busy}>
        {busy ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} />} Continue to review
      </button>
    );
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      title={target ? `New version of ${target.name}` : "Add data"}
      description={
        <span className="flex items-center gap-1.5" aria-label={`Step ${step === "source" ? 1 : 2} of 2`}>
          <span className={step === "source" ? "text-text" : "text-text-tertiary"}>Source</span>
          <ChevronRight size={12} className="text-text-tertiary" aria-hidden />
          <span className={step === "details" ? "text-text" : "text-text-tertiary"}>Details</span>
        </span>
      }
      footer={
        <>
          {step === "details" && !target && (
            <button className="btn btn-ghost mr-auto" onClick={() => { setStep("source"); setError(""); }} disabled={busy}>Back</button>
          )}
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          {primary}
        </>
      }
    >
      <div ref={bodyRef} className="space-y-4">
        {step === "source" && (
          <>
            <section aria-label="Files" className="rounded-md border border-border">
              <div className="flex items-start gap-3 px-3.5 py-3">
                <FileSpreadsheet size={16} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium">Upload files</p>
                  <p className="text-xs text-text-secondary">CSV, Excel (.xlsx) or Parquet. Select several to import them together.</p>
                </div>
              </div>
              <DropZone onFiles={addFiles} onBrowse={() => fileRef.current?.click()} />
            </section>

            <section aria-label="Databases">
              <p className="section-label mb-1.5">Databases</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {DB_SOURCES.map((s) => (
                  <button
                    key={s.type}
                    onClick={() => chooseDb(s.type)}
                    className="flex items-start gap-3 rounded-md border border-border px-3.5 py-3 text-left transition-colors hover:bg-surface-2"
                  >
                    <Database size={16} className="mt-0.5 shrink-0 text-text-secondary" aria-hidden />
                    <span>
                      <span className="block text-[13px] font-medium">{SOURCE_LABEL[s.type]}</span>
                      <span className="block text-xs text-text-secondary">{s.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {isFiles && (
          <>
            <div>
              <p className="field-label">{single ? "File" : plural(files.length, "file")}</p>
              <ul className="divide-y divide-border-subtle rounded-md border border-border">
                {files.map((f, i) => {
                  const toExisting = single && destination === "existing";
                  const s = status[i];
                  return (
                    <li key={f.name + i} className="flex items-center gap-3 px-3 py-2">
                      <FileSpreadsheet size={16} className="shrink-0 text-text-tertiary" aria-hidden />
                      <div className="min-w-0 flex-1">
                        {toExisting ? (
                          <p className="truncate text-[13px] font-medium">{f.name}</p>
                        ) : (
                          <label className="block">
                            <span className="sr-only">Dataset name for {f.name}</span>
                            <input
                              className="input"
                              value={names[i]}
                              disabled={busy}
                              onChange={(e) => setNames((n) => n.map((v, j) => (j === i ? e.target.value : v)))}
                            />
                          </label>
                        )}
                        <p className="mt-0.5 truncate font-mono text-[11.5px] text-text-tertiary">
                          {!toExisting && `${f.name} · `}{formatBytes(f.size)}
                        </p>
                      </div>
                      {s ? (
                        <span
                          className={cn(
                            "w-20 shrink-0 text-right text-xs",
                            s === "done" ? "text-success" : s === "error" ? "text-danger" : "text-text-tertiary",
                          )}
                        >
                          {STATUS_TEXT[s]}
                        </span>
                      ) : (
                        !target && (
                          <button className="btn-icon shrink-0" aria-label={`Remove ${f.name}`} onClick={() => removeFile(i)} disabled={busy}>
                            <X size={16} />
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
              {!target && !busy && (
                <button className="btn btn-ghost btn-sm mt-1.5" onClick={() => fileRef.current?.click()}>
                  <Plus size={14} /> Add files
                </button>
              )}
            </div>

            {single && (fileDatasets.length > 0 || target) && (
              <fieldset disabled={busy || !!target}>
                <legend className="field-label">Save as</legend>
                <div className="divide-y divide-border-subtle rounded-md border border-border">
                  <label className="flex items-center gap-2.5 px-3 py-2.5 text-[13px]">
                    <input type="radio" name="destination" className="accent-primary" checked={destination === "new"} onChange={() => setDestination("new")} />
                    A new dataset
                  </label>
                  <label className="flex flex-wrap items-center gap-2.5 px-3 py-2.5 text-[13px]">
                    <input type="radio" name="destination" className="accent-primary" checked={destination === "existing"} onChange={() => setDestination("existing")} />
                    A new version of
                    <select
                      className="input w-auto min-w-48 flex-1"
                      aria-label="Dataset"
                      value={existingId}
                      onChange={(e) => { setExistingId(e.target.value); setDestination("existing"); }}
                    >
                      {target && !fileDatasets.some((d) => d.id === target.id) && <option value={target.id}>{target.name}</option>}
                      {fileDatasets.map((d) => <option key={d.id} value={d.id}>{d.name} (v{d.version_count})</option>)}
                    </select>
                  </label>
                </div>
                <p className="field-hint">You'll review the rows and add clean-up steps before anything is saved.</p>
              </fieldset>
            )}

            {files.length >= 2 && (
              <div>
                <label className="flex items-start gap-2.5 text-[13px]">
                  <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={joinAfter} onChange={(e) => setJoinAfter(e.target.checked)} disabled={busy} />
                  <span>
                    Join the first two after importing
                    <span className="block text-xs text-text-secondary">
                      Opens Pipeline Studio with “{names[0] || files[0].name}” left-joined to “{names[1] || files[1].name}”.
                    </span>
                  </span>
                </label>
                <p className="field-hint">Several files are imported as they are, without a review step.</p>
              </div>
            )}
          </>
        )}

        {isDb && (
          <form id="add-data-db" onSubmit={reviewDb} className="grid gap-x-3 gap-y-3.5 sm:grid-cols-6">
            <fieldset disabled={busy} className="contents">
              <Field label="Database type" className="sm:col-span-6">
                <select className="input" value={db} onChange={(e) => chooseDb(e.target.value as DbSourceType)}>
                  {DB_SOURCES.map((s) => <option key={s.type} value={s.type}>{SOURCE_LABEL[s.type]}</option>)}
                </select>
              </Field>
              <Field label="Host" className="sm:col-span-4">
                <input className="input" required placeholder="db.example.internal" value={form.host} onChange={set("host")} />
              </Field>
              <Field label="Port" className="sm:col-span-2">
                <input className="input font-mono" required inputMode="numeric" value={form.port} onChange={set("port")} />
              </Field>
              <Field label="Database" className="sm:col-span-3">
                <input className="input" required placeholder="analytics" value={form.database} onChange={set("database")} />
              </Field>
              <Field label="Table" hint="Include the schema, e.g. public.orders" className="sm:col-span-3">
                <input className="input font-mono" required placeholder="public.orders" value={form.table} onChange={set("table")} />
              </Field>
              <Field label="Username" className="sm:col-span-3">
                <input className="input" required autoComplete="username" placeholder="readonly_user" value={form.user} onChange={set("user")} />
              </Field>
              <Field label="Password" className="sm:col-span-3">
                <input className="input" type="password" required autoComplete="current-password" value={form.password} onChange={set("password")} />
              </Field>
              {!target && (
                <Field label="Dataset name" hint="Optional. Defaults to the table name." className="sm:col-span-6">
                  <input className="input" placeholder="orders" value={form.name} onChange={set("name")} />
                </Field>
              )}
            </fieldset>
            <p className="field-hint sm:col-span-6">
              Kadence reads the table over a read-only session. Credentials are only used for this import.
            </p>
          </form>
        )}

        {error && <p role="alert" className="rounded-md border border-danger/20 bg-danger-muted px-3 py-2 text-[13px] text-danger">{error}</p>}

        <input
          ref={fileRef}
          type="file"
          multiple={!target}
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }}
        />
      </div>
    </Dialog>
  );
}

function DropZone({ onFiles, onBrowse }: { onFiles: (files: File[]) => void; onBrowse: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}
      className={cn(
        "mx-3.5 mb-3.5 flex items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-[13px] text-text-secondary transition-colors",
        over ? "border-primary bg-primary-muted" : "border-border bg-surface-2",
      )}
    >
      <Upload size={16} className="text-text-tertiary" aria-hidden />
      Drop files here or
      <button type="button" className="font-medium text-primary hover:underline" onClick={onBrowse}>browse</button>
    </div>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint block">{hint}</span>}
    </label>
  );
}
