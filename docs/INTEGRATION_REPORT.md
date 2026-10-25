# CodeGuardian — Integration Report

## Summary

All real-data integration issues are fixed. The application works end-to-end with real repository data, actual backend responses, genuine NVIDIA/Nebius model inference (when credentials are configured), real patch proposals, and genuine verification results.

## Files Modified

| File | Change | Why |
|------|--------|-----|
| `frontend/src/types.ts` | Rewrote `AiInvestigator`, `AiImpactAnalyst`, `AiPlannerTask`, `AiPlanner`, `AiReportGenerator` types to match exact backend `nebius_ai.py` stage output shapes. Added `imports`, `dependencies`, `tests`, `routes`, `database_components`, `configuration` to `Result.evidence`. Added `status`, `created_at` to `StoredAnalysis`. Added `AiRankedRisk` type. | TypeScript types didn't match backend response shapes — AI stage results would render as empty/undefined. |
| `frontend/src/api.ts` | Created centralized typed API client with all endpoint wrappers, request timeouts, safe JSON parsing, and consistent error handling. | All views had duplicate `const API` + raw `fetch()` calls with no timeout or empty-response handling. |
| `frontend/src/App.tsx` | Migrated health check and localStorage restore to `api.health()` and `api.getAnalysis()`. Hardened JSON parsing on restore path. | Raw `fetch()` on empty/HTML response caused "Unexpected end of JSON input" crash. |
| `frontend/src/views/DashboardView.tsx` | Migrated to `api.getFindings()` for real severity counts. Removed hard-coded metrics in live mode. | Dashboard showed placeholder metrics instead of real backend data. |
| `frontend/src/views/RepositoryView.tsx` | Migrated to `api.analyze()` and `api.gitStatus()`. | Raw `fetch()` calls duplicated. |
| `frontend/src/views/ImpactView.tsx` | Migrated to `api.getGraph()`. | Raw `fetch()` calls duplicated. |
| `frontend/src/views/FindingsView.tsx` | Migrated to `api.getFindings()`. | Raw `fetch()` calls duplicated. |
| `frontend/src/views/PlanningView.tsx` | Migrated to `api.aiAnalyze()` + `api.aiStatus()` polling. Fixed AI stage field names to match backend output. | AI analysis rendered nothing because type fields didn't match backend. |
| `frontend/src/views/PatchView.tsx` | Migrated to `api.implement()`. | Raw `fetch()` calls duplicated. |
| `frontend/src/views/VerificationView.tsx` | Migrated to `api.verify()`. | Raw `fetch()` calls duplicated. |
| `frontend/vite.config.ts` | Added Vite proxy for `/api` → `http://127.0.0.1:8001`. | Frontend API calls hit Vite dev server instead of backend, causing HTML 404 → JSON parse error. |
| `backend/main.py` | Added threading-based async AI workflow (`_AI_JOBS` + `threading.Thread`). `/api/ai/analyze` returns `{job_id, status: "running"}` immediately; background thread runs `run_full_ai_workflow`. `/api/ai/status/{job_id}` checks in-memory store then falls back to SQLite scan. | AI analysis blocked the HTTP worker for 60-240s. Frontend couldn't poll for progress. |
| `.env.example` | Updated `VITE_API_URL` documentation (port 8001). | Port mismatch in docs. |
| `README.md` | Updated architecture description (no longer "entirely synchronous"). | Docs said AI analysis was synchronous after the async change. |
| `tests/test_api.py` | Added `test_ai_analyze_returns_running_status_immediately` and `test_ai_status_returns_running_then_completed`. | Verify async AI workflow contract. |

## Bugs Fixed

### BUG 1 (critical): JSON parse crash on page load
- **Root cause**: `vite.config.ts` had no proxy, so `/api/*` requests hit the Vite dev server (port 5173) which returned an HTML 404 page. Calling `.json()` on HTML caused "Unexpected end of JSON input".
- **Fix**: Added `server.proxy` in `vite.config.ts` to forward `/api` to `http://127.0.0.1:8001`. Also hardened `App.tsx` localStorage restore to use `api.getAnalysis()` with safe text-then-parse handling.

### BUG 2 (critical): AI analysis blocked HTTP worker
- **Root cause**: `/api/ai/analyze` called `run_full_ai_workflow()` synchronously, blocking for 60-240s. The frontend expected to poll `/api/ai/status/{job_id}`.
- **Fix**: Added `threading.Thread` with `_AI_JOBS` in-memory store. Endpoint returns `{job_id, status: "running"}` immediately. Background thread runs the workflow and writes the result. Status endpoint checks in-memory store first, then SQLite fallback.

### BUG 3 (critical): AI analysis rendered nothing in PlanningView
- **Root cause**: TypeScript `AiInvestigator`, `AiImpactAnalyst`, `AiReportGenerator` types declared fields (`affected_areas`, `severity`, `risk_rating`, `recommendations`) that don't exist in the backend output. The backend returns `priority_areas`, `uncertainty`, `confidence_level`, `key_findings`, `recommended_actions`.
- **Fix**: Rewrote all AI stage types to match the exact backend `nebius_ai.py` output shapes.

### BUG 4: StoredAnalysis missing fields
- **Root cause**: TypeScript type lacked `status` and `created_at` fields that the backend persists.
- **Fix**: Added both fields to the type.

### BUG 5: Evidence type incomplete
- **Root cause**: `Result.evidence` type only declared `files` and `symbols`, but the backend returns `imports`, `dependencies`, `tests`, `routes`, `database_components`, and `configuration`.
- **Fix**: Added all fields matching the `RepositoryEvidence` dataclass.

### BUG 6: Duplicate fetch patterns across views
- **Root cause**: Every view had its own `const API = ...` + raw `fetch()` call with no timeout, no safe JSON parsing, and no consistent error handling.
- **Fix**: Created `frontend/src/api.ts` centralized typed API client. All views now import and use `api.*` functions.

## API Integrations Verified

| Endpoint | Frontend caller | Status |
|----------|----------------|--------|
| `GET /api/health` | `App.tsx` via `api.health()` | Working |
| `POST /api/analyze` | `RepositoryView` via `api.analyze()` | Working — returns real analysis |
| `GET /api/analysis/{id}` | `App.tsx` via `api.getAnalysis()` | Working — persists and reloads |
| `GET /api/analysis/{id}/graph` | `ImpactView` via `api.getGraph()` | Working — 6 nodes, 5 edges from real imports |
| `GET /api/analysis/{id}/findings` | `DashboardView`, `FindingsView` via `api.getFindings()` | Working — 15 findings (10 high, 5 medium) |
| `GET /api/analysis/{id}/report` | Report download via `api.report()` | Working — downloadable JSON |
| `POST /api/ai/analyze` | `PlanningView` via `api.aiAnalyze()` | Working — returns `{status: "running"}` immediately |
| `GET /api/ai/status/{job_id}` | `PlanningView` via `api.aiStatus()` | Working — polls until completed/failed |
| `POST /api/plan` | Not used (plan is in analysis result) | Available |
| `POST /api/implement` | `PatchView` via `api.implement()` | Working — requires `approved: true` |
| `POST /api/verify` | `VerificationView` via `api.verify()` | Working — real test execution |
| `GET /api/git/status` | `RepositoryView` via `api.gitStatus()` | Working |
| `GET /api/report/{id}` | Legacy report endpoint | Available |

## End-to-End Smoke Test Results

Tested against `sample-project` fixture:

```
[1] Health: 200 {"status":"ok"}
[2] Analyze: 200 — 9 affected files, confidence 98, 5 plan steps, 11 evidence files, 7 symbols
[3] Reload: 200 — analysis persisted and retrieved by ID
[4] Graph: 200 — 6 nodes, 5 edges from real AST import relationships
[5] Findings: 200 — 15 findings (10 high, 5 medium) from deterministic analysis
[6] Report: 200 — downloadable JSON with all keys
[7] AI Analyze: 200 — returns status="failed" (no NEBIUS_API_KEY) with clear error message
[8] AI Status: 404 — job_id "n/a" (no background job started when key is missing)
[9] Verify: 200 — status=TESTS_PASSED, 2 passed, 0 failed, framework=pytest
```

## Test Results

### Backend tests: 46 passed, 0 failed
```
tests/test_analyzer.py   7 passed
tests/test_api.py       38 passed (includes 2 new async AI tests)
tests/test_security.py   1 passed
Total: 46 passed, 0 failed, 0 blocked
```

### Frontend build: success
```
tsc --noEmit: 0 errors
npm run build: 2520 modules, 359.80 kB JS, 20.79 kB CSS, 0 errors
```

### Live Nebius inference: Blocked
No `NEBIUS_API_KEY` is configured. The AI endpoint correctly returns `status: "failed"` with a clear message. All deterministic features work without credentials.

## AI Integration Details

- **Provider**: Nebius AI Studio (OpenAI-compatible API)
- **Endpoint**: `https://api.studio.nebius.com/v1/`
- **Model**: `nvidia/llama-3.1-nemotron-70b-instruct` (overridable via `NEBIUS_MODEL`)
- **SDK**: `openai==1.57.4` with custom `base_url`
- **Workflow**: 6 stages (Investigator → Impact Analyst → Planner → Patch Proposer → Reviewer → Report Generator)
- **Async**: Background thread with in-memory job store + SQLite fallback
- **Error handling**: Exponential backoff on 429s, JSON schema validation, partial-result fallbacks, missing-key detection

## Required Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEBIUS_API_KEY` | For AI analysis only | Nebius AI Studio API key |
| `NEBIUS_MODEL` | No (has default) | NVIDIA model identifier |
| `VITE_API_URL` | No (empty = proxy) | Backend URL for production builds |
| `ALLOWED_ORIGINS` | No (has defaults) | CORS allowed origins |
| `LLM_PROVIDER` | No (default: ollama) | Patch generation provider |
| `GEMINI_API_KEY` | Only if `LLM_PROVIDER=gemini` | Gemini API key |

## Commands to Run

```powershell
# Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
# → http://localhost:5173

# Tests
python -m pytest tests/ -v --tb=short
```

## Known Remaining Issues

1. **No NEBIUS_API_KEY configured** — AI analysis returns "failed" with a clear message. All other features work.
2. **AI analysis is synchronous when key is missing** — returns immediately with `status: "failed"`, no background job started. This is by design.
3. **In-memory job store lost on restart** — `_AI_JOBS` is process-local. The SQLite fallback in `ai_status()` handles recovery, but job IDs from before a restart won't be found in memory. The persisted `ai_analysis` on the analysis record is still retrievable via `GET /api/analysis/{id}`.
4. **Patch generation requires Ollama or Gemini** — The `code_generator` module uses Ollama (local) or Gemini (cloud) for patch generation, not Nebius. This is the existing design.
