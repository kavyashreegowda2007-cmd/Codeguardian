from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()  # Load .env file from the project root

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from analyzer.repository import analyze_change, to_dict, validate_repository_path
from backend.findings import extract_findings_from_analysis, findings_to_dict
from backend.services import code_generator
from backend.services.implement_service import execute_implementation
from backend.services.nebius_ai import run_full_ai_workflow
from backend.storage import (
    get_analysis as load_analysis,
    save_analysis,
    update_analysis,
)
from backend.verification import verify_repository


ROOT = Path(__file__).resolve().parents[1]

app = FastAPI(title="CODEGUARDIAN API", version="0.1.0")


def _cors_origins() -> list[str]:
    """
    Build the CORS allow-list from the ALLOWED_ORIGINS environment variable.

    The variable should be a comma-separated list of origins, e.g.:
        ALLOWED_ORIGINS=https://my-frontend.onrender.com,http://localhost:5173

    If the variable is not set, the defaults below are used so that local
    development continues to work without any extra configuration.
    """
    raw = os.environ.get("ALLOWED_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    # Default: allow local dev origins only
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory AI job store (process-local; lost on restart — DB scan fallback
# in ai_status() handles recovery from the SQLite record).
# ---------------------------------------------------------------------------
_AI_JOBS: dict[str, dict[str, Any]] = {}
_AI_JOBS_LOCK = threading.Lock()

# Patch generation jobs (background thread, same pattern as AI jobs)
_PATCH_JOBS: dict[str, dict[str, Any]] = {}
_PATCH_JOBS_LOCK = threading.Lock()


class AnalyzeRequest(BaseModel):
    request: str = Field(min_length=5, max_length=500)
    repository_path: str


class VerifyRequest(BaseModel):
    repository_path: str
    analysis_id: str | None = None


class AnalysisReference(BaseModel):
    analysis_id: str


class ImplementationRequest(AnalysisReference):
    approved: bool = False
    files: list[str] = []
    generate_patch: bool = False
    patch_data: list[dict[str, str]] | None = None
    test_command: str | None = None


def _is_public_github_https_url(repository_path: str) -> bool:
    value = (repository_path or "").strip()

    if not value:
        return False

    if value.startswith('"') and value.endswith('"'):
        value = value[1:-1].strip()

    if not value:
        return False

    parsed = urlparse(value)

    if parsed.scheme.lower() != "https":
        return False

    if parsed.netloc.lower() not in {
        "github.com",
        "www.github.com",
    }:
        return False

    if "localhost" in parsed.netloc.lower() or "127.0.0.1" in parsed.netloc.lower():
        return False

    path = parsed.path.strip("/")

    if not path or ".." in path:
        return False

    parts = [part for part in path.split("/") if part]

    if len(parts) != 2:
        return False

    if any(part in {"", "."} for part in parts):
        return False

    if not re.fullmatch(r"[A-Za-z0-9_.-]+", parts[0]):
        return False

    if not re.fullmatch(
        r"[A-Za-z0-9_.-]+",
        parts[1].removesuffix(".git"),
    ):
        return False

    return True


def _clone_public_github_repo(repo_url: str) -> Path:
    if not _is_public_github_https_url(repo_url):
        raise ValueError(
            "Repository URL must be a public HTTPS GitHub repository URL."
        )

    parsed = urlparse(repo_url)

    repo_name = (
        parsed.path.strip("/")
        .split("/")[-1]
        .removesuffix(".git")
    )

    clone_root = Path(
        tempfile.mkdtemp(prefix="codeguardian-github-")
    )

    target = clone_root / repo_name

    result = subprocess.run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            repo_url,
            str(target),
        ],
        capture_output=True,
        text=True,
        timeout=180,
    )

    if result.returncode != 0:
        shutil.rmtree(
            clone_root,
            ignore_errors=True,
        )

        message = (
            result.stderr.strip()
            or result.stdout.strip()
            or "GitHub repository clone failed."
        )

        raise RuntimeError(
            f"GitHub repository clone failed: {message}"
        )

    return target.resolve()


def _resolve_repository(repository_path: str) -> Path:
    try:
        candidate = str(repository_path).strip()

        if candidate.startswith('"') and candidate.endswith('"'):
            candidate = candidate[1:-1].strip()

        if not candidate:
            raise ValueError("Repository path is required.")

        if _is_public_github_https_url(candidate):
            return _clone_public_github_repo(candidate)

        return validate_repository_path(candidate)

    except (
        FileNotFoundError,
        NotADirectoryError,
        PermissionError,
        ValueError,
        RuntimeError,
    ) as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def _cleanup_temp_repository(
    record: dict[str, object],
) -> None:
    clone_dir = record.get("temp_clone_dir")

    if not clone_dir:
        return

    try:
        shutil.rmtree(
            str(clone_dir),
            ignore_errors=True,
        )
    finally:
        record["temp_clone_dir"] = None
        update_analysis(record)


@app.post("/api/analyze")
def analyze(
    payload: AnalyzeRequest,
) -> dict[str, object]:

    repository = _resolve_repository(
        payload.repository_path
    )

    try:
        result = to_dict(
            analyze_change(
                repository,
                payload.request,
            )
        )

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Repository analysis failed: {exc}",
        ) from exc

    analysis_id = str(uuid.uuid4())

    item: dict[str, object] = {
        "id": analysis_id,
        "status": "analyzed",
        "repository_path": str(repository),
        "result": result,
    }

    if _is_public_github_https_url(
        payload.repository_path
    ):
        item["temp_clone_dir"] = str(repository)

    save_analysis(item)

    return item


@app.get("/api/analysis/{analysis_id}")
def get_analysis(
    analysis_id: str,
) -> dict[str, object]:

    item = load_analysis(analysis_id)

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    return item


@app.post("/api/plan")
def plan(
    payload: AnalysisReference,
) -> dict[str, object]:

    item = get_analysis(
        payload.analysis_id
    )

    result = item["result"]

    return {
        "analysis_id": payload.analysis_id,
        "status": "ready",
        "plan": result["plan"],
    }


@app.post("/api/implement")
def implement(
    payload: ImplementationRequest,
) -> dict[str, object]:

    item = get_analysis(
        payload.analysis_id
    )

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    result = item["result"]

    affected_files = set(
        result["affected_files"]
    )

    requested_files = (
        sorted(set(payload.files))
        if payload.files
        else sorted(affected_files)
    )

    unauthorized = sorted(
        set(requested_files) - affected_files
    )

    if unauthorized:
        raise HTTPException(
            status_code=400,
            detail={
                "message": (
                    "Implementation files must come "
                    "from the analysis result."
                ),
                "files": unauthorized,
            },
        )

    if not payload.approved:
        return {
            "analysis_id": payload.analysis_id,
            "status": "approval_required",
            "files": requested_files,
            "message": (
                "Review the plan and approve these "
                "files before implementation."
            ),
        }

    item["status"] = "implementation_approved"

    update_analysis(item)

    if payload.generate_patch and not payload.patch_data:

        try:
            generated = (
                code_generator.generate_code_patches(
                    payload.analysis_id
                )
            )

            patch_data = (
                generated.get("patch_data") or []
            )

        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

        if not patch_data:
            raise HTTPException(
                status_code=400,
                detail=(
                    "AI code generator returned "
                    "no valid patch data."
                ),
            )

        return execute_implementation(
            payload.analysis_id,
            str(
                Path(
                    item["repository_path"]
                ).resolve()
            ),
            patch_data,
            payload.test_command,
            requested_files,
        )

    if payload.patch_data:

        return execute_implementation(
            payload.analysis_id,
            str(
                Path(
                    item["repository_path"]
                ).resolve()
            ),
            payload.patch_data,
            payload.test_command,
            requested_files,
        )

    return {
        "analysis_id": payload.analysis_id,
        "status": "approved_manifest",
        "files": requested_files,
        "changed_files": [],
        "message": (
            "Manifest approved. No files were modified."
        ),
    }


@app.post("/api/verify")
def verify(
    payload: VerifyRequest,
) -> dict[str, object]:

    repository = _resolve_repository(
        payload.repository_path
    )

    item = (
        get_analysis(payload.analysis_id)
        if payload.analysis_id
        else None
    )

    if item is not None:

        analyzed_repository = Path(
            str(item["repository_path"])
        ).resolve()

        if repository != analyzed_repository:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Verification repository must match "
                    "the analyzed repository path."
                ),
            )

        repository = analyzed_repository

    verification = verify_repository(
        repository
    )

    if payload.analysis_id:

        item = get_analysis(
            payload.analysis_id
        )

        item["verification"] = verification

        item["status"] = (
            "verified"
            if verification["status"] == "TESTS_PASSED"
            else (
                "verification_failed"
                if verification["status"] == "TESTS_FAILED"
                else verification["status"]
            )
        )

        update_analysis(item)

    return verification


@app.get("/api/git/status")
def git_status(
    repository_path: str,
) -> dict[str, object]:

    repository = _resolve_repository(
        repository_path
    )

    status = subprocess.run(
        [
            "git",
            "status",
            "--short",
        ],
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=15,
    )

    diff = subprocess.run(
        [
            "git",
            "diff",
            "--stat",
        ],
        cwd=repository,
        capture_output=True,
        text=True,
        timeout=15,
    )

    return {
        "repository_path": str(repository),
        "requested_repository_path": repository_path,
        "clean": not status.stdout.strip(),
        "status": status.stdout.splitlines(),
        "diff_stat": diff.stdout.splitlines(),
    }


@app.get("/api/report/{analysis_id}")
def report(
    analysis_id: str,
) -> dict[str, object]:

    item = get_analysis(
        analysis_id
    )

    result = item["result"]

    if item.get("temp_clone_dir"):
        _cleanup_temp_repository(item)

    return {
        "analysis_id": analysis_id,
        "status": item["status"],
        "report": {
            **result,
            "verification": item.get(
                "verification",
                {
                    "status": "pending",
                    "message": (
                        "Verification has not run."
                    ),
                },
            ),
        },
    }


# ---------------------------------------------------------------------------
# New Pydantic models for the new endpoints
# ---------------------------------------------------------------------------

class AIAnalyzeRequest(BaseModel):
    analysis_id: str
    changed_files: list[str] | None = None


# ---------------------------------------------------------------------------
# GET /api/analysis/{analysis_id}/graph
# ---------------------------------------------------------------------------

@app.get("/api/analysis/{analysis_id}/graph")
def analysis_graph(
    analysis_id: str,
) -> dict[str, object]:
    """Return dependency graph data (nodes + edges) for the given analysis."""
    item = load_analysis(analysis_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    result = item.get("result", {})
    evidence = result.get("evidence", {})
    imports: dict[str, list[str]] = evidence.get("imports", {})

    tests_set: set[str] = set(evidence.get("tests", []))
    db_set: set[str] = set(evidence.get("database_components", []))
    config_set: set[str] = set(evidence.get("configuration", []))

    def _node_type(file_path: str) -> str:
        if file_path in tests_set:
            return "test"
        if file_path in db_set:
            return "database"
        if file_path in config_set:
            return "config"
        return "source"

    # Collect every file that appears in the import graph
    file_ids: set[str] = set()
    for source_file, imported_modules in imports.items():
        file_ids.add(source_file)
        # Map module dotted names back to relative file paths present in evidence
        all_files: set[str] = set(evidence.get("files", []))
        for module in imported_modules:
            candidate = module.replace(".", "/") + ".py"
            candidate_init = module.replace(".", "/") + "/__init__.py"
            if candidate in all_files:
                file_ids.add(candidate)
            elif candidate_init in all_files:
                file_ids.add(candidate_init)

    nodes = [
        {
            "id": fp,
            "label": fp.rsplit("/", 1)[-1],
            "type": _node_type(fp),
            "file": fp,
        }
        for fp in sorted(file_ids)
    ]

    edges = []
    all_files_set: set[str] = set(evidence.get("files", []))
    for source_file, imported_modules in imports.items():
        for module in imported_modules:
            candidate = module.replace(".", "/") + ".py"
            candidate_init = module.replace(".", "/") + "/__init__.py"
            target = None
            if candidate in all_files_set:
                target = candidate
            elif candidate_init in all_files_set:
                target = candidate_init
            if target and target != source_file:
                edges.append(
                    {"source": source_file, "target": target, "type": "imports"}
                )

    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# GET /api/analysis/{analysis_id}/findings
# ---------------------------------------------------------------------------

@app.get("/api/analysis/{analysis_id}/findings")
def analysis_findings(
    analysis_id: str,
) -> dict[str, object]:
    """Return structured findings with severity summary."""
    item = load_analysis(analysis_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    result = item.get("result", {})
    findings = extract_findings_from_analysis(result)
    finding_dicts = findings_to_dict(findings)

    summary: dict[str, int] = {
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0,
        "info": 0,
    }
    for f in findings:
        if f.severity in summary:
            summary[f.severity] += 1

    return {"findings": finding_dicts, "summary": summary}


# ---------------------------------------------------------------------------
# GET /api/analysis/{analysis_id}/report  (downloadable JSON)
# ---------------------------------------------------------------------------

@app.get("/api/analysis/{analysis_id}/report")
def analysis_report_download(
    analysis_id: str,
) -> JSONResponse:
    """Return a downloadable JSON report for the given analysis."""
    item = load_analysis(analysis_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    result = item.get("result", {})
    findings = extract_findings_from_analysis(result)
    finding_dicts = findings_to_dict(findings)

    report_body: dict[str, object] = {
        "analysis_id": analysis_id,
        "status": item.get("status"),
        "repository_path": item.get("repository_path"),
        "created_at": item.get("created_at"),
        "metadata": {
            "request": result.get("request"),
            "analysis_duration": result.get("analysis_duration"),
            "confidence": result.get("confidence"),
            "confidence_label": result.get("confidence_label"),
        },
        "affected_files": result.get("affected_files", []),
        "affected_components": result.get("affected_components", []),
        "affected_apis": result.get("affected_apis", []),
        "database_components": result.get("database_components", []),
        "dependencies": result.get("dependencies", []),
        "tests": result.get("tests", []),
        "findings": finding_dicts,
        "plan": result.get("plan", []),
        "verification": item.get(
            "verification",
            {"status": "pending", "message": "Verification has not run."},
        ),
        "ai_analysis": item.get("ai_analysis"),
    }

    filename = f"codeguardian-report-{analysis_id[:8]}.json"
    return JSONResponse(
        content=report_body,
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
        },
    )


# ---------------------------------------------------------------------------
# POST /api/patches/generate  — async patch generation (non-blocking)
# ---------------------------------------------------------------------------

class PatchGenerateRequest(BaseModel):
    analysis_id: str


@app.post("/api/patches/generate")
def patches_generate(payload: PatchGenerateRequest) -> dict[str, object]:
    """Start background patch generation. Returns {patch_job_id, status:'running'} immediately."""
    item = load_analysis(payload.analysis_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    patch_job_id = str(uuid.uuid4())
    with _PATCH_JOBS_LOCK:
        _PATCH_JOBS[patch_job_id] = {"patch_job_id": patch_job_id, "status": "running", "error": None}

    def _run() -> None:
        try:
            result = code_generator.generate_code_patches(payload.analysis_id)
            with _PATCH_JOBS_LOCK:
                _PATCH_JOBS[patch_job_id] = {
                    "patch_job_id": patch_job_id,
                    "status": "completed",
                    "patch_data": result.get("patch_data", []),
                    "summary": result.get("summary", ""),
                    "error": None,
                }
            # Persist on the analysis record too
            try:
                stored = load_analysis(payload.analysis_id)
                if stored is not None:
                    stored["patch_job"] = _PATCH_JOBS[patch_job_id]
                    update_analysis(stored)
            except Exception:
                pass
        except Exception as exc:
            with _PATCH_JOBS_LOCK:
                _PATCH_JOBS[patch_job_id] = {
                    "patch_job_id": patch_job_id,
                    "status": "failed",
                    "patch_data": [],
                    "error": str(exc),
                }

    threading.Thread(target=_run, daemon=True).start()
    return {"patch_job_id": patch_job_id, "status": "running", "analysis_id": payload.analysis_id}


@app.get("/api/patches/status/{patch_job_id}")
def patches_status(patch_job_id: str) -> dict[str, object]:
    """Poll for patch generation result."""
    with _PATCH_JOBS_LOCK:
        record = _PATCH_JOBS.get(patch_job_id)
    if record is not None:
        return record
    raise HTTPException(status_code=404, detail="Patch job not found")


# ---------------------------------------------------------------------------
# POST /api/ai/analyze
# ---------------------------------------------------------------------------

@app.post("/api/ai/analyze")
def ai_analyze(
    payload: AIAnalyzeRequest,
) -> dict[str, object]:
    """Trigger a full multi-stage AI analysis via Nebius AI (non-blocking)."""
    item = load_analysis(payload.analysis_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    # Check API key up front so we can return a clear message
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

    # Build repository_summary from the analysis result
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

    # Build findings from the deterministic analysis
    findings_objs = extract_findings_from_analysis(result)
    findings = findings_to_dict(findings_objs)

    # Build dependency graph from evidence.imports
    imports: dict[str, list[str]] = evidence.get("imports", {})
    dependency_graph: dict[str, object] = {"imports": imports}

    changed_files: list[str] = (
        payload.changed_files
        if payload.changed_files is not None
        else result.get("affected_files", [])
    )

    # Generate a job ID and seed the in-memory job store immediately
    job_id = str(uuid.uuid4())
    with _AI_JOBS_LOCK:
        _AI_JOBS[job_id] = {
            "job_id": job_id,
            "status": "running",
            "stages": {},
            "error": None,
        }

    def _run() -> None:
        try:
            ai_result = run_full_ai_workflow(
                analysis_id=payload.analysis_id,
                repository_summary=repository_summary,
                findings=findings,
                dependency_graph=dependency_graph,
                changed_files=changed_files,
            )
            # Override the job_id so the record is retrievable by this job_id
            ai_result["job_id"] = job_id
            with _AI_JOBS_LOCK:
                _AI_JOBS[job_id] = ai_result
            # Persist to SQLite so the result survives process restarts
            try:
                stored = load_analysis(payload.analysis_id)
                if stored is not None:
                    stored["ai_analysis"] = ai_result
                    update_analysis(stored)
            except Exception:
                pass  # Persistence failure must not crash the background thread
        except Exception as exc:  # noqa: BLE001
            error_record: dict[str, Any] = {
                "job_id": job_id,
                "status": "failed",
                "stages": {},
                "error": str(exc),
            }
            with _AI_JOBS_LOCK:
                _AI_JOBS[job_id] = error_record
            try:
                stored = load_analysis(payload.analysis_id)
                if stored is not None:
                    stored["ai_analysis"] = error_record
                    update_analysis(stored)
            except Exception:
                pass

    threading.Thread(target=_run, daemon=True).start()

    return {"job_id": job_id, "status": "running", "analysis_id": payload.analysis_id}


# ---------------------------------------------------------------------------
# GET /api/ai/status/{job_id}
# ---------------------------------------------------------------------------

@app.get("/api/ai/status/{job_id}")
def ai_status(
    job_id: str,
) -> dict[str, object]:
    """Return the AI analysis result for the given job_id.

    Checks the in-memory job store first (fast path), then falls back to a
    full SQLite scan so results remain retrievable after a process restart.
    """
    # Fast path: in-memory job store (process-local)
    with _AI_JOBS_LOCK:
        record = _AI_JOBS.get(job_id)
    if record is not None:
        return record

    # Fallback: scan all analyses records for ai_analysis.job_id == job_id
    import json as _json
    import sqlite3
    from contextlib import closing
    from backend.storage import DATABASE_PATH

    try:
        db_path = DATABASE_PATH
        with closing(sqlite3.connect(db_path)) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT record_json FROM analyses"
            ).fetchall()
    except Exception:
        raise HTTPException(status_code=404, detail="AI job not found")

    for row in rows:
        try:
            stored = _json.loads(row["record_json"])
        except Exception:
            continue
        ai = stored.get("ai_analysis")
        if isinstance(ai, dict) and ai.get("job_id") == job_id:
            return ai

    raise HTTPException(status_code=404, detail="AI job not found")


# ---------------------------------------------------------------------------
# Serve the React frontend as static files from the same process.
# The Dockerfile builds the frontend first and copies dist/ into /app/frontend/dist.
# All /api/* routes above take priority; everything else is handled here.
# ---------------------------------------------------------------------------
_FRONTEND_DIST = Path("/app/frontend/dist")

if _FRONTEND_DIST.is_dir():
    # Serve hashed assets (/assets/index-xxx.js, etc.) directly
    app.mount("/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    def serve_root() -> FileResponse:
        """Serve index.html for the root path explicitly."""
        return FileResponse(str(_FRONTEND_DIST / "index.html"))

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str) -> FileResponse:
        """Return index.html for every non-API path so React Router works."""
        requested = _FRONTEND_DIST / full_path
        if requested.is_file():
            return FileResponse(str(requested))
        return FileResponse(str(_FRONTEND_DIST / "index.html"))
