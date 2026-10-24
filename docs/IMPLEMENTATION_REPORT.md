# CodeGuardian — Implementation Report

---

## 1. Architecture Overview

### What was discovered

The existing repository contained a working FastAPI backend with:
- Repository scanner using Python AST (`analyzer/repository.py`)
- SQLite storage layer (`backend/storage.py`)
- LLM code-generation via Ollama (local) and Gemini (cloud) (`backend/services/code_generator.py`)
- Test verification runner (`backend/verification.py`)
- A React + Vite single-screen frontend with a light-theme CSS layout

The backend had 39 passing tests covering the full analysis → plan → implement → verify → report pipeline.

The checklist identified five missing backend endpoints, no Nebius AI integration, no structured findings schema, no downloadable report endpoint, and no documentation files.

### What was preserved

All existing API routes, their exact request/response contracts, and all business logic were preserved unchanged:
- `GET /api/health`
- `POST /api/analyze`
- `GET /api/analysis/{id}`
- `POST /api/plan`
- `POST /api/implement`
- `POST /api/verify`
- `GET /api/git/status`
- `GET /api/report/{analysis_id}`

All 39 pre-existing tests continue to pass after every change.

### What was added

**Backend:**
- `backend/services/nebius_ai.py` — Nebius AI integration module (6 AI stages, retry/backoff, JSON parsing)
- `backend/findings.py` — Structured findings schema (`Finding` dataclass) and extraction from analysis results
- Five new API endpoints (see section 3)
- `openai==1.57.4` added to `requirements.txt`

**Frontend:**
- Full multi-screen React application replacing the single-screen layout
- Dark midnight-navy theme with neon-green accents
- Dependency graph screen using D3.js
- Findings explorer with severity/category filters
- Fix planning workspace with diff preview
- AI analysis panel with stage-by-stage results
- Typed API client and shared TypeScript types
- React Router-based navigation

**Documentation:**
- `docs/DEMO_WORKFLOW.md`
- `docs/IMPLEMENTATION_REPORT.md`

---

## 2. All Files Modified and Why

| File | Change |
|------|--------|
| `backend/main.py` | Added five new endpoint handlers (`/api/analysis/{id}/graph`, `/api/analysis/{id}/findings`, `/api/analysis/{id}/report`, `/api/ai/analyze`, `/api/ai/status/{job_id}`); added `AIAnalyzeRequest` Pydantic model; imported `findings` module and `nebius_ai` service |
| `requirements.txt` | Added `openai==1.57.4` for the Nebius OpenAI-compatible endpoint |
| `tests/test_api.py` | Appended 5 new test functions for the new endpoints |
| `README.md` | Updated to describe current architecture, all API endpoints, environment variables, and quick-start commands |

---

## 3. All New Files Created and Their Purpose

| File | Purpose |
|------|---------|
| `backend/services/nebius_ai.py` | Nebius AI Studio integration. Implements `call_nebius()` (core LLM call with 3-attempt exponential backoff for rate limits), `run_full_ai_workflow()` (orchestrator for 6 stages), and individual stage functions: `run_investigator`, `run_impact_analyst`, `run_planner`, `run_patch_proposer`, `run_reviewer`, `run_report_generator` |
| `backend/findings.py` | `Finding` dataclass with id, severity, category, title, description, file, line, evidence, confidence, source. `extract_findings_from_analysis()` converts an ImpactResult dict into structured findings (security risks, missing test coverage, unresolved imports). `findings_to_dict()` serialises to plain dicts. |
| `docs/DEMO_WORKFLOW.md` | Step-by-step hackathon demo guide |
| `docs/IMPLEMENTATION_REPORT.md` | This file |

---

## 4. AI Integration Details

### Endpoint

```
https://api.studio.nebius.com/v1/
```

### Default Model

```
nvidia/llama-3.1-nemotron-70b-instruct
```

Overridable via the `NEBIUS_MODEL` (or `NVIDIA_MODEL`) environment variable.

### SDK

Uses the OpenAI Python SDK (`openai==1.57.4`) with a custom `base_url` pointing to the Nebius endpoint. This is the officially documented integration path for Nebius AI Studio.

```python
from openai import OpenAI
client = OpenAI(api_key=NEBIUS_API_KEY, base_url="https://api.studio.nebius.com/v1/")
```

### Retry / Backoff

`call_nebius()` retries on HTTP 429 / rate-limit errors with delays of 2 s, 4 s, 8 s. Any other error is re-raised immediately. After 3 retries, a `RuntimeError` is raised.

### JSON Output Protocol

Each stage function sends a structured system prompt that specifies the exact JSON schema required. If the model response cannot be parsed as JSON, a single retry is attempted with a correction instruction. If the second attempt also fails, a safe partial-result dict is returned so the overall workflow continues.

### AI Stages

| Stage | Function | Input | Output |
|-------|----------|-------|--------|
| 1 | `run_investigator` | repository summary, deterministic findings | confirmed/added findings, risk narrative, priority areas |
| 2 | `run_impact_analyst` | dependency graph, changed files | ranked risks, blast radius, uncertainty |
| 3 | `run_planner` | investigator + impact results | ordered repair tasks with file lists |
| 4 | `run_patch_proposer` | single task, source snippets | unified diff patch per task |
| 5 | `run_reviewer` | proposed patch, original findings | approval verdict, concerns |
| 6 | `run_report_generator` | all stage outputs | executive summary, key findings, recommended actions |

The full workflow (`run_full_ai_workflow`) runs stages 1, 2, 3, and 6. Stages 4 and 5 (per-task patch) are available but not called in the default workflow — they are designed for future per-task patch generation.

---

## 5. Safety Controls

| Control | Implementation |
|---------|----------------|
| Path validation | `validate_repository_path()` in `analyzer/repository.py`: rejects non-existent paths, files instead of directories, path traversal (`..`), and absolute paths outside the workspace unless explicitly allowed |
| No shell injection | All subprocess calls use list-form arguments (`subprocess.run(["git", "clone", ...], ...)`) — no shell string interpolation |
| GitHub URL validation | `_is_public_github_https_url()` enforces HTTPS scheme, github.com domain, exactly two path segments, alphanumeric characters only, no localhost |
| Patch approval flow | `/api/implement` requires `approved: true` — manifest is returned for review before any file is modified |
| Patch allowlist | `code_generator.generate_code_patches()` rejects any file in the generated patch that is not in the analysis `affected_files` list |
| Path traversal in patches | `execute_implementation()` resolves each patch target path and verifies it is inside the repository root before writing |
| Resource limits | `subprocess.run(..., timeout=120)` for test runs; `subprocess.run(..., timeout=180)` for git clone |
| API key isolation | No credentials in source code or committed files; all keys via environment variables |
| CORS | Only configured origins are allowed (defaults: localhost:5173 only); configurable via `ALLOWED_ORIGINS` env var |

---

## 6. Test Results

### Final test run — 44 tests total

```
tests/test_analyzer.py   7 passed
tests/test_api.py       36 passed   (39 original + 5 new = 44 total in file, 36 in this count because test_security.py has 1)
tests/test_security.py   1 passed

Total: 44 passed, 0 failed, 0 blocked
```

Full output:

```
========================= 44 passed, 37 warnings in 12.49s ==========================
```

The 37 warnings are `DeprecationWarning` from `asyncio.iscoroutinefunction` in Starlette/FastAPI — not caused by this codebase and not a test failure.

---

## 7. Frontend Build Result

```
> tsc -b && vite build
✓ 2519 modules transformed.
dist/index.html                   0.39 kB │ gzip:   0.27 kB
dist/assets/index-COqHuzF6.css   20.79 kB │ gzip:   4.34 kB
dist/assets/index-39YW9OY-.js   358.19 kB │ gzip: 110.34 kB
✓ built in 729ms
```

**Result: success.** Zero TypeScript errors, zero build errors.

---

## 8. Known Limitations

| Limitation | Detail |
|------------|--------|
| AI analysis requires NEBIUS_API_KEY | Without a valid key, `/api/ai/analyze` returns `{"status": "failed"}`. All other features work. |
| LLM code-patch generation requires Ollama or Gemini | Ollama must be running locally with the configured model, or `GEMINI_API_KEY` must be set. Without either, patch generation returns an error. |
| Dependency graph is import-level only | The graph is built from Python AST import statements. Function-level call graphs and cross-language dependency tracing are not implemented. |
| GitHub clone requires public HTTPS URLs | Private repositories and SSH URLs are not supported. |
| AI analysis is synchronous | Long AI calls block the HTTP worker. No async job queue is implemented — for hackathon scale this is acceptable. |
| No frontend tests | The frontend has no unit or integration tests. |
| Python 3.14 deprecation warnings | `asyncio.iscoroutinefunction` is deprecated in Python 3.14 and will be removed in 3.16. These warnings come from Starlette/FastAPI internals, not from this codebase. |

---

## 9. Required Environment Variables

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `PORT` | Backend listening port | `8001` | No |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowed origins | `http://localhost:5173,http://127.0.0.1:5173` | No |
| `CODEGUARDIAN_DB_PATH` | SQLite database path | `.codeguardian/analyses.sqlite3` | No |
| `LLM_PROVIDER` | LLM provider for code-patch generation: `ollama`, `gemini` | `ollama` | No |
| `OLLAMA_BASE_URL` | Ollama server base URL | `http://127.0.0.1:11434` | No |
| `OLLAMA_MODEL` | Ollama model name | `qwen2.5-coder:7b` | No |
| `GEMINI_API_KEY` | Google Gemini API key | — | Only if `LLM_PROVIDER=gemini` |
| `GEMINI_MODEL` | Gemini model name | `gemini-3.7-flash` | No |
| `NEBIUS_API_KEY` | Nebius AI Studio API key | — | Only for `/api/ai/analyze` |
| `NEBIUS_MODEL` | Nebius model name | `nvidia/llama-3.1-nemotron-70b-instruct` | No |
| `NVIDIA_API_KEY` | Fallback key name for NEBIUS_API_KEY | — | No |
| `NVIDIA_MODEL` | Fallback model name for NEBIUS_MODEL | — | No |
| `VITE_API_URL` | Backend base URL (frontend build-time) | `http://127.0.0.1:8001` | No |

---

## 10. Local Run Commands

```bash
# Backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1          # Windows
# source .venv/bin/activate           # macOS/Linux
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev

# Tests
python -m pytest tests/ -v --tb=short
```

See `docs/DEMO_WORKFLOW.md` for the full step-by-step demo guide.

---

## 11. Remaining Work

| Item | Priority | Notes |
|------|----------|-------|
| Async job queue for AI analysis | Medium | Currently synchronous; long AI calls block the HTTP worker. An in-memory `asyncio.Queue` or background thread pool would make the UX more responsive. |
| Per-task AI patch generation (stages 4 & 5) | Medium | `run_patch_proposer` and `run_reviewer` are implemented but not wired into the default workflow. A follow-up endpoint could expose patch-per-task generation. |
| Frontend unit tests | Low | No test framework is configured for the frontend. Adding Vitest + React Testing Library would improve confidence in the UI. |
| Function-level dependency graph | Low | The current graph is at the file/import level. Tree-sitter or similar would enable function-level call-graph edges. |
| Private repository support | Low | Currently only public HTTPS GitHub URLs are supported for remote repos. OAuth or token-based auth would be needed for private repos. |
| Python 3.16 compatibility | Low | `asyncio.iscoroutinefunction` deprecation warnings from Starlette/FastAPI. Track upstream fixes in those packages. |
