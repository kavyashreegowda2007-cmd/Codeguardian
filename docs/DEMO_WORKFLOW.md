# CodeGuardian — Demo Workflow

Step-by-step guide for running a live demo of CodeGuardian locally, including the included `sample-project` fixture.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11 or later | 3.12 / 3.13 / 3.14 confirmed working |
| Node.js | 18 or later | LTS recommended |
| Git | any recent | Required for the git-status endpoint and GitHub clone feature |
| NEBIUS_API_KEY | — | **Optional.** All deterministic features work without it. Only the multi-stage AI analysis (`POST /api/ai/analyze`) requires a valid key. |

---

## Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-org/codeguardian.git
cd codeguardian

# 2. Create a Python virtual environment and install dependencies
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt

# 3. Install frontend dependencies
cd frontend
npm install
cd ..

# 4. Copy the environment file and configure it
cp .env.example .env
# Edit .env if you want to set NEBIUS_API_KEY or change the port
```

---

## Start the Backend

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
```

The API will be available at `http://localhost:8001`. You can verify it is running with:

```bash
curl http://localhost:8001/api/health
# {"status":"ok"}
```

---

## Start the Frontend Dev Server

In a second terminal (with the virtual environment active if needed):

```bash
cd frontend
npm run dev
```

The frontend will be available at `http://localhost:5173`.

---

## Step-by-Step Demo

### a. Open the application

Open `http://localhost:5173` in a browser.

You will see the CodeGuardian landing page with a short description of the workflow and a "Start Analysis" call-to-action.

---

### b. Click "Start Analysis"

Click the **Start Analysis** button. This opens the main analysis form.

---

### c. Enter the repository path

In the **Repository Path** field enter:

```
sample-project
```

This relative path resolves to the `sample-project/` directory included in the repository — a small interconnected authentication application written in Python / FastAPI. It contains auth, users, and payment modules, integration tests, and deliberate security patterns for demonstration purposes.

You can also enter a full absolute path to any local Python repository, or a public GitHub HTTPS URL such as `https://github.com/owner/repo.git`.

---

### d. Enter the change request

In the **Change Request** field enter:

```
Add phone-number authentication
```

---

### e. Click "Analyze"

Click **Analyze**. The backend will:

1. Resolve the repository path and scan all supported files
2. Extract Python AST symbols, imports, routes, dependencies, and tests
3. Match change-request keywords against the evidence graph
4. Compute an impact set (affected files, APIs, database, test coverage)
5. Score confidence and generate a five-step implementation plan
6. Persist the result and return the analysis record

This takes roughly 1–2 seconds for `sample-project`.

---

### f. Navigate to Impact Analysis — show dependency graph

Click the **Impact Analysis** tab (or navigate to the Impact Analysis screen from the sidebar).

You will see:
- An interactive dependency graph built from the Python import relationships discovered in the repository
- Nodes representing source files, test files, configuration files, and database components
- Edges representing import relationships between files
- Affected files highlighted

The graph supports zoom, pan, and node selection. The panel on the right shows the full list of affected files with their roles.

The graph is built from real AST evidence extracted from the repository — not fabricated data.

---

### g. Navigate to Findings — show findings by severity

Click the **Findings** tab.

You will see:
- A severity summary bar (critical / high / medium / low / info counts)
- A filterable, searchable list of findings extracted deterministically from the repository scan
- Each finding shows: severity badge, category, title, affected file, confidence score, and source tag ("deterministic")

Finding categories include:
- **security** — hardcoded credential patterns, `eval`/`exec`, `shell=True`, sensitive values in logs
- **testing** — affected files with no corresponding test file
- **imports** — potentially unresolved import paths

---

### h. Navigate to Fix Planning — show repair plan

Click the **Fix Planning** tab.

You will see a prioritized, ordered repair plan generated from the impact analysis. The plan is grouped into five stages:

1. Core implementation files
2. Persistence / configuration updates
3. Dependency changes
4. Test updates
5. Verification steps

Each task shows the relevant files, risk tags, and a recommended action.

You can approve the plan and optionally generate a code patch using the configured LLM provider (Ollama, Gemini, or Nebius).

---

### i. (Optional — requires NEBIUS_API_KEY) Click "Run AI Analysis"

If you have set `NEBIUS_API_KEY` in your `.env` file, click **Run AI Analysis** on the analysis screen.

This triggers a multi-stage AI workflow via Nebius AI Studio (OpenAI-compatible endpoint):

| Stage | Description |
|-------|-------------|
| 1. Investigator | Reviews the repository summary and deterministic findings; confirms or adds new findings |
| 2. Impact Analyst | Ranks risk levels for each affected file; estimates blast radius |
| 3. Planner | Produces an ordered repair plan from the investigation and impact results |
| 4. Report Generator | Summarises evidence, outcomes, confidence level, and limitations |

The AI analysis runs synchronously and the result is persisted on the analysis record. You can retrieve it later from `GET /api/analysis/{id}`.

**Without NEBIUS_API_KEY:** The endpoint returns `{"status": "failed", "error": "NEBIUS_API_KEY not configured..."}` — all other features continue to work normally.

---

### j. Navigate to Verification — click "Run Tests" — show test results

Click the **Verification** tab, then click **Run Tests**.

The backend will:
1. Discover test files in the repository (pytest, unittest, or Node test runner)
2. Run the test suite as a subprocess with a 120-second timeout
3. Parse the output and return structured results: passed, failed, total, framework, exit code, and captured output

For `sample-project`, you should see 2 tests pass (pytest).

The verification result is persisted and visible in the final report.

---

### k. Navigate to Dashboard — show summary

Click the **Dashboard** tab.

You will see:
- Analysis status and repository path
- Findings grouped by severity (counts from the structured findings endpoint)
- The verification result (tests passed / failed)
- Quick links to resume at any workflow stage
- A list of recent analyses (from the SQLite store)

---

## Environment Variables Reference

| Variable | Purpose | Default | Required |
|----------|---------|---------|----------|
| `PORT` | Backend listening port | `8001` | No |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowed origins | `http://localhost:5173,http://127.0.0.1:5173` | No |
| `CODEGUARDIAN_DB_PATH` | SQLite database path | `.codeguardian/analyses.sqlite3` | No |
| `LLM_PROVIDER` | LLM provider: `ollama`, `gemini` | `ollama` | No |
| `OLLAMA_BASE_URL` | Ollama server URL | `http://127.0.0.1:11434` | No (if using Ollama) |
| `OLLAMA_MODEL` | Ollama model name | `qwen2.5-coder:7b` | No (if using Ollama) |
| `GEMINI_API_KEY` | Google Gemini API key | — | Only if `LLM_PROVIDER=gemini` |
| `GEMINI_MODEL` | Gemini model name | `gemini-3.7-flash` | No |
| `NEBIUS_API_KEY` | Nebius AI Studio API key | — | Only for AI analysis |
| `NEBIUS_MODEL` | Nebius model name | `nvidia/llama-3.1-nemotron-70b-instruct` | No |
| `NVIDIA_API_KEY` | Fallback key name for NEBIUS_API_KEY | — | No |
| `VITE_API_URL` | Backend base URL (frontend build-time) | `http://127.0.0.1:8001` | No |

---

## What to Expect Without NEBIUS_API_KEY

All deterministic features work without any API key:

| Feature | Requires key? |
|---------|---------------|
| Repository scanning (AST, imports, routes, dependencies) | No |
| Change-impact analysis | No |
| Dependency graph endpoint (`/api/analysis/{id}/graph`) | No |
| Structured findings endpoint (`/api/analysis/{id}/findings`) | No |
| Downloadable report (`/api/analysis/{id}/report`) | No |
| Implementation plan | No |
| Patch approval flow | No |
| Test verification | No |
| Git status | No |
| LLM code-patch generation (Ollama or Gemini) | Requires Ollama running locally OR Gemini key |
| Multi-stage AI analysis (`POST /api/ai/analyze`) | **Yes — NEBIUS_API_KEY required** |

When `NEBIUS_API_KEY` is absent and `/api/ai/analyze` is called, the endpoint returns HTTP 200 with `{"status": "failed", "error": "NEBIUS_API_KEY not configured..."}`. This is intentional — the rest of the analysis remains available.
