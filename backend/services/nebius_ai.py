"""Nebius AI integration module using the OpenAI-compatible SDK.

Uses NEBIUS_API_KEY / NEBIUS_MODEL env vars (NVIDIA_API_KEY / NVIDIA_MODEL as
fallbacks) and routes to https://api.tokenfactory.nebius.com/v1/

Note: Nebius AI Studio was renamed to Nebius Token Factory.
The new API base URL is https://api.tokenfactory.nebius.com/v1/
The old studio URL (api.studio.nebius.com) no longer serves models.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------

_NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
_DEFAULT_MODEL = "nvidia/Nemotron-3_5-Lightning"


def _api_key() -> str:
    key = os.environ.get("NEBIUS_API_KEY", "").strip()
    if not key:
        key = os.environ.get("NVIDIA_API_KEY", "").strip()
    return key


def _model() -> str:
    model = os.environ.get("NEBIUS_MODEL", "").strip()
    if not model:
        model = os.environ.get("NVIDIA_MODEL", "").strip()
    return model or _DEFAULT_MODEL


# ---------------------------------------------------------------------------
# Core LLM call with retry / backoff
# ---------------------------------------------------------------------------

def call_nebius(messages: list[dict], timeout: int = 30) -> str:
    """Call the Nebius AI endpoint and return the assistant reply string.

    Raises
    ------
    RuntimeError
        If NEBIUS_API_KEY is not set, if a non-retryable error occurs, or if
        all retries are exhausted.
    """
    key = _api_key()
    if not key:
        raise RuntimeError(
            "NEBIUS_API_KEY is not set. "
            "Configure this environment variable to enable AI analysis."
        )

    try:
        from openai import OpenAI  # type: ignore[import-untyped]
    except ImportError as exc:
        raise RuntimeError(
            "The openai Python package is not installed. "
            "Run: pip install openai==1.57.4"
        ) from exc

    client = OpenAI(api_key=key, base_url=_NEBIUS_BASE_URL)
    model = _model()

    last_exc: Exception | None = None
    delays = [2, 4, 8]

    for attempt, delay in enumerate([0] + delays):
        if delay:
            time.sleep(delay)
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,  # type: ignore[arg-type]
                timeout=timeout,
            )
            content = response.choices[0].message.content
            if content is None:
                raise RuntimeError("Nebius AI returned an empty response.")
            return content
        except Exception as exc:  # noqa: BLE001
            # Detect rate-limit errors (HTTP 429) by inspecting the exception
            exc_str = str(exc).lower()
            is_rate_limit = (
                "429" in exc_str
                or "rate limit" in exc_str
                or "too many requests" in exc_str
            )
            if is_rate_limit and attempt < len(delays):
                last_exc = exc
                continue
            # Any other error on any attempt — re-raise immediately
            raise RuntimeError(
                f"Nebius AI call failed: {exc}"
            ) from exc

    raise RuntimeError(
        f"Nebius AI rate limit exceeded after {len(delays)} retries: {last_exc}"
    ) from last_exc


# ---------------------------------------------------------------------------
# JSON output helpers
# ---------------------------------------------------------------------------

def _parse_json_response(raw: str) -> dict[str, Any] | None:
    """Try to parse a JSON object from the model response string."""
    text = raw.strip()
    # Strip markdown fences if present
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop the first line (``` or ```json) and trailing ```
        inner = []
        for line in lines[1:]:
            if line.strip() == "```":
                break
            inner.append(line)
        text = "\n".join(inner).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _call_with_retry(messages: list[dict], timeout: int = 60) -> dict[str, Any] | None:
    """Call Nebius and attempt to parse JSON; retry once if parsing fails."""
    raw = call_nebius(messages, timeout=timeout)
    result = _parse_json_response(raw)
    if result is not None:
        return result
    # Retry once: ask the model to fix its output
    retry_messages = messages + [
        {"role": "assistant", "content": raw},
        {
            "role": "user",
            "content": (
                "Your previous response was not valid JSON. "
                "Return only the JSON object, no prose, no markdown fences."
            ),
        },
    ]
    raw2 = call_nebius(retry_messages, timeout=timeout)
    return _parse_json_response(raw2)


# ---------------------------------------------------------------------------
# Multi-stage workflow functions
# ---------------------------------------------------------------------------

def run_investigator(repository_summary: dict, findings: list[dict]) -> dict:
    """Stage 1 — Senior code investigator.

    Returns a structured investigation report dict.
    """
    system = (
        "You are a senior code investigator. "
        "Given a repository summary and security/quality findings evidence, "
        "produce a structured investigation report as a single JSON object. "
        "The output must match exactly:\n"
        '{"findings_confirmed": [...], "findings_added": [...], '
        '"risk_narrative": "<string>", "priority_areas": ["<string>", ...]}'
    )
    user = (
        f"Repository summary:\n{json.dumps(repository_summary, indent=2)}\n\n"
        f"Findings evidence:\n{json.dumps(findings, indent=2)}\n\n"
        "Return only the JSON object described above."
    )
    result = _call_with_retry(
        [{"role": "system", "content": system}, {"role": "user", "content": user}]
    )
    required = {"findings_confirmed", "findings_added", "risk_narrative", "priority_areas"}
    if result is None or not required.issubset(result.keys()):
        return {
            "findings_confirmed": [],
            "findings_added": [],
            "risk_narrative": "AI analysis unavailable: invalid response",
            "priority_areas": [],
            "partial": True,
        }
    return result


def run_impact_analyst(dependency_graph: dict, changed_files: list[str]) -> dict:
    """Stage 2 — Impact analyst.

    Returns a ranked impact assessment dict.
    """
    system = (
        "You are an impact analyst. "
        "Given a dependency graph and a list of changed files, "
        "produce a ranked impact assessment as a single JSON object. "
        "The output must match exactly:\n"
        '{"impact_summary": "<string>", '
        '"ranked_risks": [{"file": "<str>", "risk_level": "<str>", "reason": "<str>"}], '
        '"blast_radius": <integer>, "uncertainty": "<string>"}'
    )
    user = (
        f"Dependency graph:\n{json.dumps(dependency_graph, indent=2)}\n\n"
        f"Changed files:\n{json.dumps(changed_files, indent=2)}\n\n"
        "Return only the JSON object described above."
    )
    result = _call_with_retry(
        [{"role": "system", "content": system}, {"role": "user", "content": user}]
    )
    required = {"impact_summary", "ranked_risks", "blast_radius", "uncertainty"}
    if result is None or not required.issubset(result.keys()):
        return {
            "impact_summary": "AI impact analysis unavailable: invalid response",
            "ranked_risks": [],
            "blast_radius": 0,
            "uncertainty": "unknown",
            "partial": True,
        }
    return result


def run_planner(investigation: dict, impact: dict) -> dict:
    """Stage 3 — Repair planner.

    Returns an ordered repair plan dict.
    """
    system = (
        "You are a repair planner. "
        "Given an investigation report and an impact assessment, "
        "produce an ordered repair plan as a single JSON object. "
        "The output must match exactly:\n"
        '{"tasks": [{"id": "<str>", "title": "<str>", "description": "<str>", '
        '"files": ["<str>"], "priority": <int>, '
        '"complexity_estimate": "<str>", "rationale": "<str>"}]}'
    )
    user = (
        f"Investigation report:\n{json.dumps(investigation, indent=2)}\n\n"
        f"Impact assessment:\n{json.dumps(impact, indent=2)}\n\n"
        "Return only the JSON object described above."
    )
    result = _call_with_retry(
        [{"role": "system", "content": system}, {"role": "user", "content": user}]
    )
    if result is None or "tasks" not in result:
        return {"tasks": [], "partial": True}
    return result


def run_patch_proposer(task: dict, source_snippets: dict) -> dict:
    """Stage 4 — Patch proposer.

    Returns a unified diff patch dict for a single repair task.
    """
    system = (
        "You are a patch proposer. "
        "Given a specific repair task and relevant source code snippets, "
        "produce a unified diff patch as a single JSON object. "
        "The output must match exactly:\n"
        '{"file": "<str>", "unified_diff": "<str>", '
        '"explanation": "<str>", "confidence": <float 0.0-1.0>}'
    )
    user = (
        f"Repair task:\n{json.dumps(task, indent=2)}\n\n"
        f"Source snippets:\n{json.dumps(source_snippets, indent=2)}\n\n"
        "Return only the JSON object described above."
    )
    result = _call_with_retry(
        [{"role": "system", "content": system}, {"role": "user", "content": user}]
    )
    required = {"file", "unified_diff", "explanation", "confidence"}
    if result is None or not required.issubset(result.keys()):
        return {
            "file": task.get("files", ["unknown"])[0] if task.get("files") else "unknown",
            "unified_diff": "",
            "explanation": "AI patch proposal unavailable: invalid response",
            "confidence": 0.0,
            "partial": True,
        }
    return result


def run_reviewer(patch: dict, original_findings: list[dict]) -> dict:
    """Stage 5 — Code reviewer.

    Validates a proposed patch against original findings and safety constraints.
    """
    system = (
        "You are a code reviewer. "
        "Validate the proposed patch against the original findings and safety constraints. "
        "Produce a review verdict as a single JSON object. "
        "The output must match exactly:\n"
        '{"approved": <bool>, "concerns": ["<str>", ...], "verdict": "<str>"}'
    )
    user = (
        f"Proposed patch:\n{json.dumps(patch, indent=2)}\n\n"
        f"Original findings:\n{json.dumps(original_findings, indent=2)}\n\n"
        "Return only the JSON object described above."
    )
    result = _call_with_retry(
        [{"role": "system", "content": system}, {"role": "user", "content": user}]
    )
    required = {"approved", "concerns", "verdict"}
    if result is None or not required.issubset(result.keys()):
        return {
            "approved": False,
            "concerns": ["AI review unavailable"],
            "verdict": "REVIEW_FAILED",
            "partial": True,
        }
    return result


def run_report_generator(stages: dict) -> dict:
    """Stage 6 — Report generator.

    Summarises evidence, outcomes, and uncertainty from all analysis stages.
    """
    system = (
        "You are a report generator. "
        "Summarise the evidence, outcomes, and uncertainty from all analysis stages. "
        "Produce a summary report as a single JSON object. "
        "The output must match exactly:\n"
        '{"executive_summary": "<str>", "key_findings": ["<str>", ...], '
        '"recommended_actions": ["<str>", ...], '
        '"confidence_level": "<str>", "limitations": ["<str>", ...]}'
    )
    user = (
        f"Analysis stages:\n{json.dumps(stages, indent=2)}\n\n"
        "Return only the JSON object described above."
    )
    result = _call_with_retry(
        [{"role": "system", "content": system}, {"role": "user", "content": user}]
    )
    required = {
        "executive_summary",
        "key_findings",
        "recommended_actions",
        "confidence_level",
        "limitations",
    }
    if result is None or not required.issubset(result.keys()):
        return {
            "executive_summary": "AI report generation unavailable: invalid response",
            "key_findings": [],
            "recommended_actions": [],
            "confidence_level": "unknown",
            "limitations": ["AI report generation failed"],
            "partial": True,
        }
    return result


# ---------------------------------------------------------------------------
# Full AI workflow orchestrator
# ---------------------------------------------------------------------------

def run_full_ai_workflow(
    analysis_id: str,
    repository_summary: dict,
    findings: list[dict],
    dependency_graph: dict,
    changed_files: list[str],
) -> dict:
    """Run all AI analysis stages in order and return a combined result.

    Returns
    -------
    dict
        Keys: job_id, status ("completed"|"partial"|"failed"), stages, error.
    """
    job_id = str(uuid.uuid4())

    key = _api_key()
    if not key:
        return {
            "job_id": job_id,
            "status": "failed",
            "stages": {},
            "error": (
                "NEBIUS_API_KEY is not set. "
                "Configure this environment variable to enable AI analysis."
            ),
        }

    stages: dict[str, Any] = {}
    any_partial = False

    try:
        stages["investigator"] = run_investigator(repository_summary, findings)
        if stages["investigator"].get("partial"):
            any_partial = True
    except RuntimeError as exc:
        stages["investigator"] = {
            "findings_confirmed": [],
            "findings_added": [],
            "risk_narrative": f"Stage failed: {exc}",
            "priority_areas": [],
            "partial": True,
        }
        any_partial = True

    try:
        stages["impact_analyst"] = run_impact_analyst(dependency_graph, changed_files)
        if stages["impact_analyst"].get("partial"):
            any_partial = True
    except RuntimeError as exc:
        stages["impact_analyst"] = {
            "impact_summary": f"Stage failed: {exc}",
            "ranked_risks": [],
            "blast_radius": 0,
            "uncertainty": "unknown",
            "partial": True,
        }
        any_partial = True

    try:
        stages["planner"] = run_planner(
            stages["investigator"], stages["impact_analyst"]
        )
        if stages["planner"].get("partial"):
            any_partial = True
    except RuntimeError as exc:
        stages["planner"] = {"tasks": [], "partial": True, "error": str(exc)}
        any_partial = True

    try:
        stages["report_generator"] = run_report_generator(stages)
        if stages["report_generator"].get("partial"):
            any_partial = True
    except RuntimeError as exc:
        stages["report_generator"] = {
            "executive_summary": f"Stage failed: {exc}",
            "key_findings": [],
            "recommended_actions": [],
            "confidence_level": "unknown",
            "limitations": [str(exc)],
            "partial": True,
        }
        any_partial = True

    status = "partial" if any_partial else "completed"
    return {
        "job_id": job_id,
        "status": status,
        "stages": stages,
        "error": None,
    }
