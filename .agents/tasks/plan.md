# CodeGuardian — End-to-End Integration Fix Plan

## Audit Findings (pre-implementation)

### BUG 1 — `/api/ai/analyze` is synchronous (blocks 60-120 s)
`main.py` calls `run_full_ai_workflow(...)` directly inside the route handler. The function runs four sequential Nebius API calls (investigator → impact_analyst → planner → report_generator), each with a 60 s timeout, so the HTTP request can block for over 4 minutes. The frontend sends a POST to `/api/ai/analyze`, gets back `{job_id, status, analysis_id}`, then polls `/api/ai/status/{job_id}` — but the route is already synchronous and returns *after* all stages finish, not immediately. The poll endpoint exists but is never reached during normal flow because the initial POST never returns in time.

**Fix:** Spawn a `threading.Thread` for `run_full_ai_workflow`, store job state in an in-memory `dict[str, dict]`, return `{job_id, status: "running", analysis_id}` immediately. `/api/ai/status/{job_id}` reads from the same dict (or falls back to the DB scan if the process restarted).

### BUG 2 — `AiAnalysis` frontend type does not match backend return shape
`run_full_ai_workflow` returns:
```
{
  "job_id": str,
  "status": "completed"|"partial"|"failed",
  "stages": {
    "investigator": { findings_confirmed, findings_added, risk_narrative, priority_areas },
    "impact_analyst": { impact_summary, ranked_risks, blast_radius, uncertainty },
    "planner": { tasks: [{ id, title, description, files, priority, complexity_estimate, rationale }] },
    "report_generator": { executive_summary, key_findings, recommended_actions, confidence_level, limitations }
  },
  "error": str|None
}
```
`types.ts AiAnalysis` currently has:
```typescript
planner?: { tasks?: { task: string; priority: string; reason: string }[] };
risk_assessor?: { risks?: ... };
patch_proposer?: { patches?: ...; explanation?: string };
```
These keys (`risk_assessor`, `patch_proposer`) do not exist anywhere in the backend. `planner.tasks` uses `task`/`priority`/`reason` but the backend returns `title`/`priority`/`rationale`/`description`/`files`/`complexity_estimate`. The `stages` wrapper key is completely missing from the frontend type.

`PlanningView.tsx` reads `aiAnalysis.planner?.tasks` — this will always be `undefined` because the actual data lives in `aiAnalysis.stages.planner.tasks`.

**Fix:** Rewrite `AiAnalysis` in `types.ts` to wrap all stage data under `stages`, matching the backend exactly.

### BUG 3 — `StoredAnalysis` missing `status` and `created_at`
`save_analysis` stores `{ id, status, repository_path, result, created_at }` in the DB. `get_analysis` returns the full stored record. `App.tsx` does `data.id`, `data.repository_path`, `data.result`, `data.verification` — it reads `data.id` which is correct, but `StoredAnalysis` in `types.ts` has no `status` or `created_at`. The `App.tsx` restore-from-localStorage flow casts to `StoredAnalysis` and calls `data.id`, which works, but if any code later needs `data.status` TypeScript will reject it. The `RepositoryView` casts the POST response to `StoredAnalysis` and reads `data.id` and `data.repository_path` — both fine — but TypeScript completeness is broken.

**Fix:** Add `status: string` and `created_at?: string` to `StoredAnalysis` in `types.ts`.

### BUG 4 — App.tsx reload flow: `analysisId` never persisted before restore
`App.tsx` persists `data.id` to `localStorage` key `codeguardian.analysisId` correctly inside `RepositoryView.analyze()`. The reload effect reads that key and calls `/api/analysis/${savedId}`. This flow is mostly correct. However, if the restore fetch returns a record whose `result.request` is different from the initial default `"Add phone-number authentication"`, the user sees a stale request string in the form. Additionally, after restore `setResult(data.result)` is called but `result.evidence` may not include all fields the UI reads (e.g. `result.evidence.imports` — which is included in `to_dict()`). This is a minor cosmetic issue, not a crash, but `StoredAnalysis` needs `status` and `created_at` to avoid TypeScript compile errors introduced by BUG 3's fix.

**No separate code change needed beyond BUG 3's types fix.**

### BUG 5 — Graph endpoint may return 0 nodes
`/api/analysis/{id}/graph` builds nodes from `evidence["imports"]`. `to_dict(result)` in `repository.py` calls `asdict(result)` which serializes `RepositoryEvidence` including `imports: dict[str, list[str]]`. So `evidence.imports` *is* populated as long as the analyzed Python files have import statements. For repos with no Python files (e.g. pure JS), `imports` will be `{}` and the graph will have 0 nodes. This is correct behavior — the graph is intentionally empty for non-Python repos. No code fix is required; the frontend already handles `nodes.length === 0` with an empty-state message.

**No code fix needed.** Confirmed `to_dict` at line `output["evidence"]["symbols"] = [asdict(symbol) for symbol in result.evidence.symbols]` and the `asdict(result)` call includes `imports`.

### BUG 6 — `.env.example` NEBIUS_MODEL not documented
Confirmed: `nebius_ai.py` reads `NEBIUS_MODEL` env var (line: `model = os.environ.get("NEBIUS_MODEL", "").strip()`). `.env.example` already documents `NEBIUS_MODEL` (commented out). **No fix needed.** Variable is present.

### BUG 7 — `Verification` type `command` field: backend returns `list[list[str]]`, frontend type is `string[][]`
`verify_repository` returns `"command": executed_commands` where `executed_commands: list[list[str]]`. `Verification.command` in `types.ts` is `string[][]`. This matches. **No fix needed.**

### BUG 8 — `vite.config.ts` proxy target is port `8001` but `.env.example` says `PORT=8001`
`vite.config.ts` proxy target is `http://127.0.0.1:8001`. `.env.example` sets `PORT=8001` and `VITE_API_URL=http://127.0.0.1:8001`. App.tsx sets `const API = \`${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") || ""}/api\``. When `VITE_API_URL` is set (via `.env`), the Vite proxy is bypassed and direct calls go to port 8001. When `VITE_API_URL` is empty (no `.env`), the proxy at `/api` catches calls and routes to `http://127.0.0.1:8001`. Both paths work. **No fix needed.**

### BUG 9 — CORS default includes both `http://localhost:5173` and `http://127.0.0.1:5173`
`main.py _cors_origins()` returns `["http://localhost:5173", "http://127.0.0.1:5173"]` as defaults. **No fix needed.**

### BUG 10 — `PlanningView` AI result display reads wrong keys
`PlanningView.tsx` renders `aiAnalysis.planner?.tasks` and maps `t.task`, `t.priority`, `t.reason`. After BUG 2's type fix, the path will be `aiAnalysis.stages?.planner?.tasks` with fields `t.title`, `t.description`, `t.rationale`, `t.priority`. **Fix required as part of BUG 2's view update.**

### BUG 11 — `PlanningView` does not display `stages.investigator`, `stages.impact_analyst`, or `stages.report_generator`
The AI workflow returns four populated stages but the view only tries to display `planner.tasks`. The other stages (risk narrative, impact summary, executive summary) are silently dropped. **Fix: expand PlanningView to display all four stages.**

### BUG 12 — `/api/ai/analyze` returns `{job_id, status, analysis_id}` but the frontend tries to poll `/api/ai/status/{job_id}` only when `data.job_id !== "n/a"`
When the key is missing the poll is skipped. After the async fix (BUG 1), status will be `"running"` and `job_id` will be a real UUID. The poll flow is correct for the async case; it just needs the initial endpoint to be async. **Covered by BUG 1 fix.**

### BUG 13 — `DashboardView` "Backend Online" shown for any successful health fetch
`DashboardView` shows the "Backend Online" approval note based on the `backendOnline` prop, which is set by a health check fetch in `App.tsx`. This is correct — it shows "ONLINE" only when `r.ok` is true. **No bug.**

### BUG 14 — Demo data in `FindingsView` and `ImpactView` is correctly gated
`FindingsView` uses `DEMO_FINDINGS` only when `isDemoMode` is true. `ImpactView` uses `DEMO_GRAPH_NODES`/`DEMO_GRAPH_EDGES` only when `isDemoMode` is true. **No bug.**

---

## Implementation Plan

---

### Phase 1 — `frontend/src/types.ts`: Fix type definitions

- [ ] 1. Fix `AiAnalysis`, `StoredAnalysis`, and add `AiStages` sub-types.

  **Findings:** `AiAnalysis` has wrong keys (`planner`, `risk_assessor`, `patch_proposer`) that do not match the backend's `stages.investigator`, `stages.impact_analyst`, `stages.planner`, `stages.report_generator`. `StoredAnalysis` is missing `status: string` and `created_at?: string`.

  **Changes to `frontend/src/types.ts`:**

  1. Remove the existing `AiAnalysis` type entirely.
  2. Add the following types at the bottom of the file:

  ```typescript
  export type AiInvestigator = {
    findings_confirmed: unknown[];
    findings_added: unknown[];
    risk_narrative: string;
    priority_areas: string[];
    partial?: boolean;
  };

  export type AiImpactAnalyst = {
    impact_summary: string;
    ranked_risks: { file: string; risk_level: string; reason: string }[];
    blast_radius: number;
    uncertainty: string;
    partial?: boolean;
  };

  export type AiPlannerTask = {
    id: string;
    title: string;
    description: string;
    files: string[];
    priority: number;
    complexity_estimate: string;
    rationale: string;
  };

  export type AiPlanner = {
    tasks: AiPlannerTask[];
    partial?: boolean;
    error?: string;
  };

  export type AiReportGenerator = {
    executive_summary: string;
    key_findings: string[];
    recommended_actions: string[];
    confidence_level: string;
    limitations: string[];
    partial?: boolean;
  };

  export type AiStages = {
    investigator?: AiInvestigator;
    impact_analyst?: AiImpactAnalyst;
    planner?: AiPlanner;
    report_generator?: AiReportGenerator;
  };

  export type AiAnalysis = {
    job_id: string;
    status: string;           // "running" | "completed" | "partial" | "failed"
    stages?: AiStages;
    error?: string | null;
  };
  ```

  3. Add `status: string` and `created_at?: string` fields to `StoredAnalysis`:

  ```typescript
  export type StoredAnalysis = {
    id: string;
    status: string;
    created_at?: string;
    repository_path: string;
    result: Result;
    verification?: Verification;
    ai_analysis?: AiAnalysis;
  };
  ```

  **Files:** `frontend/src/types.ts`

  **Verify:** `cd frontend && npx tsc --noEmit` — zero type errors (after Phase 5 view updates).

---

### Phase 2 — `frontend/src/api.ts`: Centralize API calls (new file)

- [ ] 2. Create `frontend/src/api.ts` with a typed API client.

  **Findings:** API calls are currently duplicated inline across `App.tsx`, `RepositoryView.tsx`, `DashboardView.tsx`, `FindingsView.tsx`, `ImpactView.tsx`, `PlanningView.tsx`, `PatchView.tsx`, and `VerificationView.tsx`. Each file independently constructs `const API = \`${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") || ""}/api\``. Centralizing removes duplication and ensures consistent error handling.

  Create `frontend/src/api.ts` with:

  ```typescript
  import type {
    StoredAnalysis, Result, Verification, ImplementationResult,
    Finding, FindingsSummary, GraphNode, GraphEdge, AiAnalysis,
  } from "./types";

  export const API_BASE = `${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") || ""}/api`;

  async function request<T>(
    path: string,
    init?: RequestInit,
    timeoutMs = 180_000,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await res.text();
      if (!text.trim()) throw new Error("Empty response from server");
      const data = JSON.parse(text) as T;
      if (!res.ok) {
        const detail = (data as { detail?: string | { message?: string } }).detail;
        const msg = typeof detail === "string"
          ? detail
          : typeof detail === "object" && detail !== null
          ? detail.message ?? "Request failed"
          : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  export const api = {
    health: () => request<{ status: string }>("/health", undefined, 5_000),

    analyze: (repositoryPath: string, requestText: string) =>
      request<StoredAnalysis>("/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository_path: repositoryPath, request: requestText }),
      }),

    getAnalysis: (analysisId: string) =>
      request<StoredAnalysis>(`/analysis/${analysisId}`),

    getFindings: (analysisId: string) =>
      request<{ findings: Finding[]; summary: FindingsSummary }>(
        `/analysis/${analysisId}/findings`,
      ),

    getGraph: (analysisId: string) =>
      request<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
        `/analysis/${analysisId}/graph`,
      ),

    getPlan: (analysisId: string) =>
      request<{ analysis_id: string; status: string; plan: unknown[] }>(
        "/plan",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysis_id: analysisId }),
        },
      ),

    implement: (payload: {
      analysis_id: string;
      approved?: boolean;
      generate_patch?: boolean;
      patch_data?: { file: string; unified_diff: string }[];
      test_command?: string;
      files?: string[];
    }) =>
      request<ImplementationResult>("/implement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),

    verify: (repositoryPath: string, analysisId?: string) =>
      request<Verification>("/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository_path: repositoryPath, analysis_id: analysisId }),
      }),

    aiAnalyze: (analysisId: string, changedFiles?: string[]) =>
      request<{ job_id: string; status: string; analysis_id: string; error?: string }>(
        "/ai/analyze",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analysis_id: analysisId, changed_files: changedFiles }),
        },
        300_000,   // 5 min timeout for synchronous path; will be short after BUG 1 fix
      ),

    aiStatus: (jobId: string) =>
      request<AiAnalysis>(`/ai/status/${jobId}`),

    gitStatus: (repositoryPath: string) =>
      request<{ clean: boolean; status: string[]; diff_stat: string[] }>(
        `/git/status?repository_path=${encodeURIComponent(repositoryPath)}`,
      ),

    report: (analysisId: string) =>
      request<{ analysis_id: string; status: string; report: unknown }>(
        `/report/${analysisId}`,
      ),
  };
  ```

  **Files:** `frontend/src/api.ts` (new file)

  **Verify:** `cd frontend && npx tsc --noEmit` — zero new errors.

---

### Phase 3 — `backend/main.py`: Make `/api/ai/analyze` asynchronous

- [ ] 3. Add in-memory job store and background threading to `/api/ai/analyze`.

  **Findings:** The current `ai_analyze()` route calls `run_full_ai_workflow(...)` synchronously. The full workflow (4 Nebius API stages, each up to 60 s) can block for 240+ seconds. The frontend expects an immediate `{job_id, status: "running", analysis_id}` response and then polls `/api/ai/status/{job_id}`. The `/api/ai/status/{job_id}` endpoint currently scans all analysis records in the DB — this works after the job completes and `item["ai_analysis"]` is written, but returns 404 while the job is running. With the fix, the in-memory store is checked first so polling works immediately.

  **Add to `backend/main.py`** (after the existing imports, before route definitions):

  ```python
  import threading
  from typing import Any

  # In-memory job store: job_id → ai_result dict (updated in place)
  _AI_JOBS: dict[str, dict[str, Any]] = {}
  _AI_JOBS_LOCK = threading.Lock()
  ```

  **Replace the `ai_analyze` route body** (keep signature and API key check; change only the execution and return):

  ```python
  @app.post("/api/ai/analyze")
  def ai_analyze(payload: AIAnalyzeRequest) -> dict[str, object]:
      """Trigger a full multi-stage AI analysis via Nebius AI (non-blocking)."""
      item = load_analysis(payload.analysis_id)
      if item is None:
          raise HTTPException(status_code=404, detail="Analysis not found")

      nebius_key = (
          os.environ.get("NEBIUS_API_KEY", "").strip()
          or os.environ.get("NVIDIA_API_KEY", "").strip()
      )
      if not nebius_key:
          return {
              "job_id": "n/a",
              "status": "failed",
              "analysis_id": payload.analysis_id,
              "error": (
                  "NEBIUS_API_KEY not configured. "
                  "Set this environment variable to enable AI analysis."
              ),
          }

      result = item.get("result", {})
      evidence = result.get("evidence", {})

      repository_summary: dict[str, object] = {
          "repository_path": item.get("repository_path"),
          "request": result.get("request"),
          "affected_files": result.get("affected_files", []),
          "affected_components": result.get("affected_components", []),
          "affected_apis": result.get("affected_apis", []),
          "database_components": result.get("database_components", []),
          "dependencies": result.get("dependencies", []),
          "tests": result.get("tests", []),
          "confidence": result.get("confidence"),
          "impact_message": result.get("impact_message"),
      }

      findings_objs = extract_findings_from_analysis(result)
      findings = findings_to_dict(findings_objs)

      imports: dict[str, list[str]] = evidence.get("imports", {})
      dependency_graph: dict[str, object] = {"imports": imports}

      changed_files: list[str] = (
          payload.changed_files
          if payload.changed_files is not None
          else result.get("affected_files", [])
      )

      # Generate job_id upfront so we can return immediately
      job_id = str(uuid.uuid4())

      # Seed the in-memory store with "running" status
      running_record: dict[str, Any] = {
          "job_id": job_id,
          "status": "running",
          "stages": {},
          "error": None,
      }
      with _AI_JOBS_LOCK:
          _AI_JOBS[job_id] = running_record

      def _run() -> None:
          try:
              ai_result = run_full_ai_workflow(
                  analysis_id=payload.analysis_id,
                  repository_summary=repository_summary,
                  findings=findings,
                  dependency_graph=dependency_graph,
                  changed_files=changed_files,
              )
              # Override job_id so the stored result uses the pre-generated id
              ai_result["job_id"] = job_id
          except Exception as exc:  # noqa: BLE001
              ai_result = {
                  "job_id": job_id,
                  "status": "failed",
                  "stages": {},
                  "error": str(exc),
              }

          with _AI_JOBS_LOCK:
              _AI_JOBS[job_id] = ai_result

          # Persist to DB so status endpoint works after process restart
          try:
              stored = load_analysis(payload.analysis_id)
              if stored is not None:
                  stored["ai_analysis"] = ai_result
                  update_analysis(stored)
          except Exception:  # noqa: BLE001
              pass  # Non-fatal: in-memory store still works in this process

      thread = threading.Thread(target=_run, daemon=True)
      thread.start()

      return {
          "job_id": job_id,
          "status": "running",
          "analysis_id": payload.analysis_id,
      }
  ```

  **Replace the `ai_status` route** to check in-memory store first:

  ```python
  @app.get("/api/ai/status/{job_id}")
  def ai_status(job_id: str) -> dict[str, object]:
      """Return the AI analysis status/result for the given job_id."""
      # Check in-memory store first (covers running jobs)
      with _AI_JOBS_LOCK:
          record = _AI_JOBS.get(job_id)
      if record is not None:
          return record

      # Fall back to DB scan (covers completed jobs after process restart)
      import json as _json
      import sqlite3 as _sqlite3
      from contextlib import closing as _closing
      from backend.storage import DATABASE_PATH

      try:
          with _closing(_sqlite3.connect(DATABASE_PATH)) as conn:
              conn.row_factory = _sqlite3.Row
              rows = conn.execute("SELECT record_json FROM analyses").fetchall()
      except Exception:
          raise HTTPException(status_code=404, detail="AI job not found")

      for row in rows:
          try:
              db_record = _json.loads(row["record_json"])
          except Exception:
              continue
          ai = db_record.get("ai_analysis")
          if isinstance(ai, dict) and ai.get("job_id") == job_id:
              return ai

      raise HTTPException(status_code=404, detail="AI job not found")
  ```

  **Also add `import threading` and `from typing import Any` at top of file** (they are already present via `from __future__ import annotations` and existing `Any` usage — confirm `threading` is added).

  **Files:** `backend/main.py`

  **Verify:** `cd <project-root> && python -m pytest tests/test_api.py::test_ai_analyze_without_api_key_reports_missing_credentials -xvs` — passes. Then add a new test (Phase 6) for the async path.

---

### Phase 4 — `backend/services/nebius_ai.py`: No changes required

- [ ] 4. (Audit confirmation only — no code change)

  `run_full_ai_workflow` already returns the correct shape:
  ```
  { job_id, status, stages: { investigator, impact_analyst, planner, report_generator }, error }
  ```
  The four stage functions return their documented shapes. `_DEFAULT_MODEL` is `"nvidia/llama-3.1-nemotron-70b-instruct"`. `NEBIUS_MODEL` env var is read and `.env.example` documents it. No changes needed.

---

### Phase 5 — Frontend views: Update to use correct types and `api.ts`

#### 5a — `frontend/src/views/PlanningView.tsx`: Fix AI result display

- [ ] 5a. Update `PlanningView` to read `aiAnalysis.stages` and display all four stage results.

  **Findings:**
  - `runAiAnalysis()` polls `/api/ai/status/{job_id}` and casts result to `AiAnalysis`. After the type fix it has `.stages`, not flat `.planner`.
  - Current render code does `aiAnalysis.planner?.tasks?.map(t => t.task / t.priority / t.reason)` — all three paths are wrong after the type fix.
  - The view needs to poll with a timeout (job may still be "running" when the status fetch happens, since the endpoint now returns immediately).

  **Changes:**

  1. Import `api` from `"../api"` instead of using inline `fetch`.
  2. In `runAiAnalysis()`, after the initial POST returns `{job_id, status: "running"}`, poll `/api/ai/status/{job_id}` with a 3-second interval until `status !== "running"` (max 100 polls = ~5 min):

  ```typescript
  async function runAiAnalysis() {
    if (!analysisId) return;
    setAiLoading(true);
    setAiError("");
    try {
      const trigger = await api.aiAnalyze(analysisId);
      if (trigger.status === "failed" && trigger.error) {
        setAiError(trigger.error);
        return;
      }
      if (!trigger.job_id || trigger.job_id === "n/a") return;

      // Poll until done
      let aiData = await api.aiStatus(trigger.job_id);
      let polls = 0;
      while (aiData.status === "running" && polls < 100) {
        await new Promise(r => setTimeout(r, 3000));
        aiData = await api.aiStatus(trigger.job_id);
        polls++;
      }
      setAiAnalysis(aiData);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI analysis failed");
    } finally {
      setAiLoading(false);
    }
  }
  ```

  3. Replace the AI result display section to read from `aiAnalysis.stages`:

  ```tsx
  {aiAnalysis && !aiLoading && (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, color: "var(--color-accent)", marginBottom: 12 }}>
        AI analysis {aiAnalysis.status} — Job ID: {aiAnalysis.job_id}
      </div>

      {/* Investigator */}
      {aiAnalysis.stages?.investigator && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 8 }}>Risk Narrative</div>
          <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{aiAnalysis.stages.investigator.risk_narrative}</p>
          {aiAnalysis.stages.investigator.priority_areas.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {aiAnalysis.stages.investigator.priority_areas.map((area, i) => (
                <code key={i} style={{ fontSize: 11 }}>{area}</code>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Impact Analyst */}
      {aiAnalysis.stages?.impact_analyst && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 8 }}>Impact Assessment (blast radius: {aiAnalysis.stages.impact_analyst.blast_radius})</div>
          <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{aiAnalysis.stages.impact_analyst.impact_summary}</p>
        </div>
      )}

      {/* Planner tasks */}
      {aiAnalysis.stages?.planner?.tasks && aiAnalysis.stages.planner.tasks.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 10 }}>AI-Generated Repair Tasks</div>
          {aiAnalysis.stages.planner.tasks.map((t, i) => (
            <div key={t.id ?? i} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--color-border)" }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "var(--color-accent)", minWidth: 28 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>{t.title}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{t.description}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "'DM Mono', monospace" }}>{t.rationale}</div>
                {t.files && t.files.length > 0 && (
                  <div className="file-pills" style={{ marginTop: 6 }}>
                    {t.files.map(f => <code key={f}>{f}</code>)}
                  </div>
                )}
              </div>
              <span className="risk-tag medium">{t.complexity_estimate}</span>
            </div>
          ))}
        </div>
      )}

      {/* Report generator */}
      {aiAnalysis.stages?.report_generator && (
        <div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 8 }}>Executive Summary</div>
          <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{aiAnalysis.stages.report_generator.executive_summary}</p>
          {aiAnalysis.stages.report_generator.recommended_actions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Recommended Actions</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {aiAnalysis.stages.report_generator.recommended_actions.map((a, i) => (
                  <li key={i} style={{ fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {aiAnalysis.error && (
        <ErrorBanner message={`AI workflow error: ${aiAnalysis.error}`} />
      )}
    </div>
  )}
  ```

  **Files:** `frontend/src/views/PlanningView.tsx`

  **Verify:** `cd frontend && npx tsc --noEmit` — zero errors on PlanningView.

#### 5b — `frontend/src/views/RepositoryView.tsx`: Minor — use `api.ts`

- [ ] 5b. Replace inline `fetch` calls in `RepositoryView` with `api.analyze()` and `api.gitStatus()`.

  **Findings:** Identical `API` constant is re-declared; the analysis fetch uses a raw `fetch` that doesn't share timeout/error logic with other views. Replace with `api.analyze(...)` and `api.gitStatus(...)`.

  **Changes:**
  1. Add `import { api } from "../api";` at the top.
  2. Remove the local `const API = ...` declaration.
  3. Replace `fetch(\`${API}/analyze\`, ...)` with `const data = await api.analyze(repositoryPath, request);`.
  4. Replace `fetch(\`${API}/git/status?repository_path=...\`)` with `const gitData = await api.gitStatus(repositoryPath);`.
  5. Keep the `window.localStorage.setItem("codeguardian.analysisId", data.id);` call.
  6. Keep the `onAnalysisComplete(data.id, data.repository_path, data.result);` call.

  **Files:** `frontend/src/views/RepositoryView.tsx`

  **Verify:** `cd frontend && npx tsc --noEmit` — zero errors.

#### 5c — `frontend/src/App.tsx`: Use `api.ts` for health check and restore

- [ ] 5c. Replace inline fetches in `App.tsx` with `api.health()` and `api.getAnalysis()`.

  **Findings:** `App.tsx` duplicates the `const API` pattern and uses raw `fetch` for both `/api/health` and `/api/analysis/${savedId}`. Switching to `api.ts` calls unifies error handling and removes the pattern duplication.

  **Changes:**
  1. Add `import { api } from "./api";` at top.
  2. Remove `const API = ...` declaration.
  3. Replace `fetch(\`${API}/health\`)` in the health check effect with `api.health()`.
  4. Replace `fetch(\`${API}/analysis/${savedId}\`)` in the restore effect with `api.getAnalysis(savedId)`.
  5. The health check effect becomes:

  ```typescript
  useEffect(() => {
    api.health()
      .then(() => setBackendOnline(true))
      .catch(() => setBackendOnline(false));
  }, []);
  ```

  6. The restore effect becomes:

  ```typescript
  useEffect(() => {
    const savedId = window.localStorage.getItem("codeguardian.analysisId");
    if (!savedId) return;
    api.getAnalysis(savedId)
      .then(data => {
        setAnalysisId(data.id);
        setRepositoryPath(data.repository_path);
        setRequest(data.result.request);
        setResult(data.result);
        setVerification(data.verification ?? null);
      })
      .catch(() => { /* silently skip if backend is down */ });
  }, []);
  ```

  **Files:** `frontend/src/App.tsx`

  **Verify:** `cd frontend && npx tsc --noEmit` — zero errors.

#### 5d — `frontend/src/views/DashboardView.tsx`, `FindingsView.tsx`, `ImpactView.tsx`, `VerificationView.tsx`, `PatchView.tsx`: Use `api.ts`

- [ ] 5d. Replace all remaining inline `const API = ...` + `fetch(...)` patterns in views with `api.*` calls.

  **Findings:** Every view independently declares `const API = \`${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") || ""}/api\``. Each uses raw `fetch` with ad-hoc error handling. Replacing with `api.ts` ensures consistent timeouts and type safety.

  **For each file listed below, apply this pattern:**
  - Add `import { api } from "../api";`
  - Remove the local `const API = ...` line
  - Replace each `fetch(\`${API}/...\`, ...)` with the corresponding `api.*()` call

  **DashboardView.tsx:**
  - `fetch(\`${API}/analysis/${analysisId}/findings\`)` → `api.getFindings(analysisId)`

  **FindingsView.tsx:**
  - `fetch(\`${API}/analysis/${analysisId}/findings\`)` → `api.getFindings(analysisId)`

  **ImpactView.tsx:**
  - `fetch(\`${API}/analysis/${analysisId}/graph\`)` → `api.getGraph(analysisId)`

  **VerificationView.tsx:**
  - `fetch(\`${API}/verify\`, ...)` → `api.verify(repositoryPath, analysisId || undefined)`

  **PatchView.tsx:**
  - `fetch(\`${API}/implement\`, ...) ` (approveImplementation) → `api.implement({ analysis_id: analysisId, approved: true })`
  - `fetch(\`${API}/implement\`, ...)` (generatePatches) → `api.implement({ analysis_id: analysisId, approved: true, generate_patch: true })`

  **Files:** `frontend/src/views/DashboardView.tsx`, `frontend/src/views/FindingsView.tsx`, `frontend/src/views/ImpactView.tsx`, `frontend/src/views/VerificationView.tsx`, `frontend/src/views/PatchView.tsx`

  **Verify:** `cd frontend && npx tsc --noEmit` — zero errors across all views.

---

### Phase 6 — `tests/`: Add tests for async AI workflow

- [ ] 6. Add tests for the async AI job flow and the in-memory job store.

  **Findings:** The existing `test_api.py::test_ai_analyze_without_api_key_reports_missing_credentials` tests the no-key path. There are no tests for:
  - The async start → status poll flow.
  - The in-memory store being populated with "running" immediately after POST.
  - The job completing and status reflecting "completed" or "partial".

  **Add to `tests/test_api.py`** (at the end of the file):

  ```python
  def test_ai_analyze_returns_running_status_immediately(monkeypatch):
      """POST /api/ai/analyze returns running status immediately; does not block."""
      import backend.main as main_module

      # Provide a fake API key so the key check passes
      monkeypatch.setenv("NEBIUS_API_KEY", "fake-key-for-test")

      # Patch run_full_ai_workflow to sleep briefly then return a result
      def fake_workflow(**kwargs):
          import time
          time.sleep(0.1)
          return {
              "job_id": kwargs.get("analysis_id", "test"),
              "status": "completed",
              "stages": {
                  "investigator": {"findings_confirmed": [], "findings_added": [], "risk_narrative": "ok", "priority_areas": []},
                  "impact_analyst": {"impact_summary": "ok", "ranked_risks": [], "blast_radius": 0, "uncertainty": "low"},
                  "planner": {"tasks": []},
                  "report_generator": {"executive_summary": "ok", "key_findings": [], "recommended_actions": [], "confidence_level": "high", "limitations": []},
              },
              "error": None,
          }

      monkeypatch.setattr(main_module, "run_full_ai_workflow", fake_workflow)

      analysis = client.post(
          "/api/analyze",
          json={"request": "Add phone-number authentication", "repository_path": "sample-project"},
      ).json()
      analysis_id = analysis["id"]

      import time
      start = time.perf_counter()
      response = client.post("/api/ai/analyze", json={"analysis_id": analysis_id})
      elapsed = time.perf_counter() - start

      assert response.status_code == 200
      body = response.json()
      # Should return immediately (well under 2 s), not after the workflow completes
      assert elapsed < 2.0, f"Expected immediate return but took {elapsed:.2f}s"
      assert body["status"] == "running"
      assert body["job_id"] != "n/a"
      assert body["analysis_id"] == analysis_id


  def test_ai_status_returns_running_then_completed(monkeypatch):
      """GET /api/ai/status/{job_id} returns the job result once the thread finishes."""
      import time
      import backend.main as main_module

      monkeypatch.setenv("NEBIUS_API_KEY", "fake-key-for-test")

      completion_event = {"done": False}

      def fake_workflow(**kwargs):
          while not completion_event["done"]:
              time.sleep(0.05)
          return {
              "job_id": "will-be-overridden",
              "status": "completed",
              "stages": {
                  "investigator": {"findings_confirmed": [], "findings_added": [], "risk_narrative": "all good", "priority_areas": ["module_x"]},
                  "impact_analyst": {"impact_summary": "low", "ranked_risks": [], "blast_radius": 1, "uncertainty": "low"},
                  "planner": {"tasks": [{"id": "T1", "title": "Fix it", "description": "fix", "files": [], "priority": 1, "complexity_estimate": "low", "rationale": "needed"}]},
                  "report_generator": {"executive_summary": "clean", "key_findings": [], "recommended_actions": [], "confidence_level": "high", "limitations": []},
              },
              "error": None,
          }

      monkeypatch.setattr(main_module, "run_full_ai_workflow", fake_workflow)

      analysis = client.post(
          "/api/analyze",
          json={"request": "Add phone-number authentication", "repository_path": "sample-project"},
      ).json()
      analysis_id = analysis["id"]

      trigger = client.post("/api/ai/analyze", json={"analysis_id": analysis_id})
      assert trigger.status_code == 200
      job_id = trigger.json()["job_id"]

      # Job is running — status should be "running"
      status_running = client.get(f"/api/ai/status/{job_id}")
      assert status_running.status_code == 200
      assert status_running.json()["status"] == "running"

      # Let the thread finish
      completion_event["done"] = True
      time.sleep(0.3)

      status_done = client.get(f"/api/ai/status/{job_id}")
      assert status_done.status_code == 200
      assert status_done.json()["status"] == "completed"
      assert status_done.json()["stages"]["planner"]["tasks"][0]["title"] == "Fix it"
  ```

  **Files:** `tests/test_api.py`

  **Verify:** `python -m pytest tests/test_api.py -x -q` — all existing tests plus the two new ones pass.

---

### Phase 7 — Documentation

- [ ] 7. Update `.env.example` and `README.md` to document the async AI workflow and VITE_API_URL usage.

  **Findings:**
  - `.env.example` already documents `NEBIUS_API_KEY`, `NEBIUS_MODEL`, `VITE_API_URL`, and `PORT`. It is nearly complete.
  - The `VITE_API_URL` comment says "For local dev: `http://127.0.0.1:8000`" but the actual default port in `PORT=8001`. This will confuse developers.
  - There is no note about the async AI workflow or the in-memory job store (process restart drops running jobs).

  **Changes to `.env.example`:**
  1. Change the VITE_API_URL local dev comment from `8000` to `8001` to match `PORT=8001`:
     ```
     # For local dev: http://127.0.0.1:8001  (must match PORT above)
     ```

  **Changes to `README.md`** (or add a `docs/AI_WORKFLOW.md` section):
  1. Add a note under "AI Analysis" explaining:
     - POST `/api/ai/analyze` returns `{job_id, status: "running"}` immediately.
     - Poll GET `/api/ai/status/{job_id}` until `status` is not `"running"`.
     - The in-memory job store is process-local; if the backend restarts while a job is running, the job is lost. The result is persisted to SQLite after completion and is recoverable via the DB scan fallback.
     - Requires `NEBIUS_API_KEY` environment variable.

  **Files:** `.env.example`, `README.md` (or `docs/AI_WORKFLOW.md` if README is too long)

  **Verify:** Human review. No automated check needed.

---

## Dependency Order Summary

```
Phase 1 (types.ts) → must complete before Phase 2 (api.ts) can compile
Phase 2 (api.ts)   → must complete before Phase 5 views can use api.*
Phase 3 (main.py)  → independent of frontend; must complete before Phase 6 tests
Phase 4            → audit only, no changes
Phase 5a–5d        → depend on Phase 1 and 2; can be done in one pass
Phase 6 tests      → depend on Phase 3 (async main.py)
Phase 7 docs       → independent, last
```

## Verification Commands

- Backend tests: `python -m pytest tests/ -x -q` (run from project root with virtualenv active)
- Frontend type check: `cd frontend && npx tsc --noEmit`
- Frontend build: `cd frontend && npm run build` (requires Node.js and npm)
- Manual integration test:
  1. Start backend: `uvicorn backend.main:app --port 8001`
  2. Start frontend: `cd frontend && npm run dev`
  3. Open `http://localhost:5173`, enter a local repo path, run analysis
  4. Navigate to Planning, click "Run AI Analysis" (requires `NEBIUS_API_KEY`)
  5. Observe immediate response; verify poll loop updates status to "completed"
  6. Reload page, confirm analysis is restored from localStorage

## Files Modified Summary

| File | Change |
|------|--------|
| `frontend/src/types.ts` | Rewrite `AiAnalysis` to use `stages`; add `status`/`created_at` to `StoredAnalysis`; add sub-types |
| `frontend/src/api.ts` | New file — centralized typed API client |
| `frontend/src/App.tsx` | Use `api.health()` and `api.getAnalysis()` |
| `frontend/src/views/PlanningView.tsx` | Fix AI result display; add polling loop; read from `stages.*` |
| `frontend/src/views/RepositoryView.tsx` | Use `api.analyze()` and `api.gitStatus()` |
| `frontend/src/views/DashboardView.tsx` | Use `api.getFindings()` |
| `frontend/src/views/FindingsView.tsx` | Use `api.getFindings()` |
| `frontend/src/views/ImpactView.tsx` | Use `api.getGraph()` |
| `frontend/src/views/VerificationView.tsx` | Use `api.verify()` |
| `frontend/src/views/PatchView.tsx` | Use `api.implement()` |
| `backend/main.py` | Add `_AI_JOBS` in-memory store; make `/api/ai/analyze` non-blocking via `threading.Thread`; update `/api/ai/status` to check store first |
| `tests/test_api.py` | Add two new tests for async AI flow |
| `.env.example` | Fix `VITE_API_URL` comment port from 8000 → 8001 |
| `README.md` | Document async AI workflow contract |
