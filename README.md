# CodeGuardian — AI Code Impact & Repair Agent

CodeGuardian scans a code repository, identifies what a proposed change might break, extracts evidence, proposes a safe repair plan, executes verification tests, and exports a structured report. It combines deterministic static analysis with an optional multi-stage AI workflow powered by Nebius AI Studio.

---

## Architecture

```
Frontend (React + Vite)          Backend (FastAPI + Python)
  └── React Router                 └── analyzer/repository.py   — AST scan, import graph
  └── D3.js dependency graph       └── backend/findings.py      — structured findings
  └── Findings explorer            └── backend/services/
  └── Fix planning workspace             nebius_ai.py            — Nebius AI integration
  └── Verification screen                code_generator.py       — Ollama / Gemini patches
                                   └── backend/verification.py  — pytest / unittest runner
                                   └── backend/storage.py       — SQLite persistence
```

The backend is synchronous for all endpoints except `POST /api/ai/analyze`, which returns immediately with `{"status": "running"}` and runs the multi-stage Nebius AI workflow in a background daemon thread. Poll `GET /api/ai/status/{job_id}` until the status changes. All other analysis, verification, and patch calls run inline with the HTTP request. The SQLite database persists analysis records at `.codeguardian/analyses.sqlite3`.

---

## Quick Start

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
```

The API will be available at `http://localhost:8001`. Health check: `GET /api/health`.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`.

### Tests

```powershell
python -m pytest tests/ -v --tb=short
```

---

## API Endpoints

### Core workflow

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check — returns `{"status": "ok"}` |
| `POST` | `/api/analyze` | Scan a repository and run change-impact analysis |
| `GET` | `/api/analysis/{id}` | Retrieve a stored analysis record by ID |
| `POST` | `/api/plan` | Return the implementation plan for a stored analysis |
| `POST` | `/api/implement` | Approve or execute a code patch against the repository |
| `POST` | `/api/verify` | Run the repository's test suite and persist the result |
| `GET` | `/api/git/status` | Read git working-tree status (read-only) |
| `GET` | `/api/report/{id}` | Fetch combined analysis + verification report |

### New endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/analysis/{id}/graph` | Dependency graph data (nodes + edges) for D3 rendering |
| `GET` | `/api/analysis/{id}/findings` | Structured findings list with severity summary |
| `GET` | `/api/analysis/{id}/report` | Downloadable JSON report (attachment) |
| `POST` | `/api/ai/analyze` | Trigger multi-stage AI analysis via Nebius AI Studio |
| `GET` | `/api/ai/status/{job_id}` | Retrieve AI analysis result by job ID |

### Request / response shapes

**POST /api/analyze**
```json
{ "request": "Add phone-number authentication", "repository_path": "sample-project" }
```
Response includes `id`, `status`, `repository_path`, `result` (affected files, components, APIs, DB, tests, security risks, plan, evidence).

**GET /api/analysis/{id}/findings**
```json
{
  "findings": [
    {
      "id": "F-A1B2C3",
      "severity": "high",
      "category": "security",
      "title": "Plaintext credential comparison in app/auth/service.py",
      "file": "app/auth/service.py",
      "line": 12,
      "confidence": 0.85,
      "source": "deterministic"
    }
  ],
  "summary": { "critical": 0, "high": 1, "medium": 3, "low": 0, "info": 0 }
}
```

**POST /api/ai/analyze**
```json
{ "analysis_id": "<uuid>" }
```
Response: `{ "job_id": "<uuid>", "status": "running", "analysis_id": "<uuid>" }`

The endpoint returns `{"status": "running"}` **immediately** — the multi-stage AI workflow runs in a background thread. Poll `GET /api/ai/status/{job_id}` every 3 seconds until `status` is no longer `"running"`.

**GET /api/ai/status/{job_id}**

Returns the current job state. While the background thread is in progress: `{"status": "running", "job_id": "...", "stages": {}, "error": null}`. After completion: `{"status": "completed", "stages": {...}, ...}`.

> **Note:** The in-memory job store is process-local — it is lost on server restart. After a restart, `GET /api/ai/status/{job_id}` falls back to a full SQLite scan and returns the persisted result if the job completed before the restart. Jobs that were still `"running"` at restart time will return 404; re-trigger the analysis.

---

## AI Integration

The multi-stage AI workflow uses the **Nebius AI Studio** OpenAI-compatible endpoint with the `nvidia/llama-3.1-nemotron-70b-instruct` model by default.

```
Base URL: https://api.studio.nebius.com/v1/
SDK:      openai==1.57.4 (OpenAI Python SDK, custom base_url)
```

**This feature requires `NEBIUS_API_KEY`.** All deterministic features (scanning, impact analysis, findings, graph, verification) work without any API key.

### Async workflow

`POST /api/ai/analyze` returns `{"job_id": "<uuid>", "status": "running", "analysis_id": "<uuid>"}` **within milliseconds**. The six-stage analysis (Investigator → Impact Analyst → Planner → Patch Proposer → Reviewer → Report Generator) runs in a background daemon thread.

Poll `GET /api/ai/status/{job_id}` every 3 seconds until `status` is not `"running"`:

| `status` value | Meaning |
|----------------|---------|
| `"running"` | Background thread is still executing |
| `"completed"` | All stages finished without partial failures |
| `"partial"` | At least one stage returned a degraded result |
| `"failed"` | A fatal error occurred (see `error` field) |

The result is persisted to SQLite after completion. The in-memory job store is process-local (lost on restart), but `GET /api/ai/status/{job_id}` falls back to a DB scan so completed results remain accessible after a restart.

When called without a key, `/api/ai/analyze` returns `{"status": "failed", "error": "NEBIUS_API_KEY not configured..."}` — it does not return HTTP 500.

---

## Environment Variables

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `PORT` | Backend port | `8001` | No |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `http://localhost:5173,...` | No |
| `CODEGUARDIAN_DB_PATH` | SQLite database path | `.codeguardian/analyses.sqlite3` | No |
| `LLM_PROVIDER` | Code-patch LLM: `ollama`, `gemini` | `ollama` | No |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://127.0.0.1:11434` | No |
| `OLLAMA_MODEL` | Ollama model | `qwen2.5-coder:7b` | No |
| `GEMINI_API_KEY` | Google Gemini API key | — | Only if `LLM_PROVIDER=gemini` |
| `GEMINI_MODEL` | Gemini model | `gemini-3.7-flash` | No |
| `NEBIUS_API_KEY` | Nebius AI Studio key | — | Only for AI analysis |
| `NEBIUS_MODEL` | Nebius model | `nvidia/llama-3.1-nemotron-70b-instruct` | No |
| `NVIDIA_API_KEY` | Fallback for NEBIUS_API_KEY | — | No |
| `VITE_API_URL` | Backend base URL (Vite build-time) | `http://127.0.0.1:8001` | No |

Copy `.env.example` to `.env` and fill in the values you need.

---

## GitHub Public Repository Support

The `repository_path` field in `/api/analyze` accepts a public HTTPS GitHub URL:

```
https://github.com/owner/repo.git
```

The backend validates the URL, shallow-clones into a temporary directory, runs the analysis, and cleans up the clone after the report is retrieved.

---

## Docker

```powershell
docker compose up --build
```

The frontend is available at `http://localhost:5173` and the API at `http://localhost:8001`.

---

## Project Layout

```
backend/            FastAPI app, storage, verification, services
  services/
    nebius_ai.py    Nebius AI Studio integration (6-stage workflow)
    code_generator.py  Ollama / Gemini patch generation
  findings.py       Structured findings schema and extraction
  main.py           All API routes
  storage.py        SQLite persistence
  verification.py   Test runner (pytest / unittest / Node)
analyzer/           Repository scanner and impact analysis (AST)
sample-project/     Included demo project (Python / FastAPI auth app)
frontend/           React + Vite multi-screen UI
tests/              Backend test suite (44 tests)
docs/
  DEMO_WORKFLOW.md          Step-by-step demo guide
  IMPLEMENTATION_REPORT.md  Technical implementation narrative
  IMPLEMENTATION_CHECKLIST.md  Audit and upgrade plan
```

---

## Full Demo Guide

See **[docs/DEMO_WORKFLOW.md](docs/DEMO_WORKFLOW.md)** for the complete step-by-step walkthrough, including all screens, the AI analysis stage, and what to expect without a NEBIUS_API_KEY.
