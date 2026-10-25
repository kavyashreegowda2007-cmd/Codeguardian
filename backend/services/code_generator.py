from __future__ import annotations

import difflib
import json
import os
import re
import urllib.request
from pathlib import Path
from typing import Any

from backend.storage import get_analysis

OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434"
OLLAMA_DEFAULT_MODEL = "qwen2.5-coder:7b"
GEMINI_DEFAULT_MODEL = "gemini-3.7-flash"

OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning:free"


def _llm_provider() -> str:
    return os.getenv("LLM_PROVIDER", "openrouter").strip().lower()


def _ollama_base_url() -> str:
    return os.getenv("OLLAMA_BASE_URL", OLLAMA_DEFAULT_BASE_URL)


def _ollama_model() -> str:
    return os.getenv("OLLAMA_MODEL", OLLAMA_DEFAULT_MODEL)


def _gemini_api_key() -> str:
    return os.getenv("GEMINI_API_KEY", "").strip()


def _gemini_model() -> str:
    return os.getenv("GEMINI_MODEL", GEMINI_DEFAULT_MODEL).strip()


def _openrouter_api_key() -> str:
    return os.getenv("OPENROUTER_API_KEY", "").strip()


def _openrouter_base_url() -> str:
    return os.getenv("OPENROUTER_BASE_URL", OPENROUTER_DEFAULT_BASE_URL).strip().rstrip("/")


def _openrouter_model() -> str:
    return os.getenv("OPENROUTER_MODEL", OPENROUTER_DEFAULT_MODEL).strip()


def _call_ollama(payload: dict[str, Any]) -> str:
    base_url = _ollama_base_url().rstrip("/")
    request = urllib.request.Request(
        f"{base_url}/api/generate",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        chunks: list[str] = []
        for raw in response:
            if not raw:
                continue
            chunk = json.loads(raw.decode("utf-8"))
            text = chunk.get("response", "")
            if text:
                chunks.append(text)
        return "".join(chunks)


def _call_gemini(prompt: str) -> str:
    api_key = _gemini_api_key()
    if not api_key:
        raise RuntimeError("Gemini API key is not configured. Set GEMINI_API_KEY before selecting the Gemini provider.")
    model = _gemini_model()
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.2}}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if "error" in payload:
        message = payload["error"].get("message", "Gemini request failed.")
        raise RuntimeError(message)
    candidates = payload.get("candidates", [])
    chunks: list[str] = []
    for candidate in candidates:
        for part in candidate.get("content", {}).get("parts", []):
            text = part.get("text")
            if isinstance(text, str):
                chunks.append(text)
    if not chunks:
        raise ValueError("Gemini response did not include any generated content.")
    return "".join(chunks)


def _call_openrouter(prompt: str) -> str:
    """Call OpenRouter's OpenAI-compatible chat completions API.

    Uses the ``openai`` SDK pointed at the OpenRouter base URL.
    Returns the assistant's message content as a string.
    """
    api_key = _openrouter_api_key()
    if not api_key:
        raise RuntimeError(
            "OpenRouter API key is not configured. "
            "Set OPENROUTER_API_KEY to enable AI patch generation."
        )

    try:
        from openai import OpenAI  # type: ignore[import-untyped]
    except ImportError as exc:
        raise RuntimeError(
            "The openai Python package is not installed. "
            "Run: pip install openai==1.57.4"
        ) from exc

    base_url = _openrouter_base_url()
    model = _openrouter_model()

    client = OpenAI(api_key=api_key, base_url=base_url)

    last_exc: Exception | None = None
    delays = [2, 4, 8]

    for attempt, delay in enumerate([0] + delays):
        if delay:
            import time
            time.sleep(delay)
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a code generation assistant. "
                            "Return only valid JSON as requested. "
                            "Do not include markdown fences or prose. "
                            "All newlines inside JSON string values MUST be escaped as \\n. "
                            "All quotes inside JSON string values MUST be escaped as \\\"."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                timeout=600,  # 10 minutes — free-tier models can be slow
            )
            content = response.choices[0].message.content
            if content is None:
                raise RuntimeError("OpenRouter returned an empty response.")
            return content
        except Exception as exc:  # noqa: BLE001
            exc_str = str(exc).lower()
            is_rate_limit = (
                "429" in exc_str
                or "rate limit" in exc_str
                or "too many requests" in exc_str
            )
            if is_rate_limit and attempt < len(delays):
                last_exc = exc
                continue
            # Non-rate-limit errors or exhausted retries
            raise RuntimeError(f"OpenRouter API call failed: {exc}") from exc

    raise RuntimeError(
        f"OpenRouter rate limit exceeded after {len(delays)} retries: {last_exc}"
    ) from last_exc


def _call_llm(prompt: str) -> str:
    provider = _llm_provider()
    if provider == "openrouter":
        return _call_openrouter(prompt)
    if provider == "gemini":
        return _call_gemini(prompt)
    if provider == "ollama":
        return _call_ollama({"model": _ollama_model(), "prompt": prompt, "stream": False})
    raise RuntimeError(f"Unsupported LLM provider: {provider}")


def _load_plan_context(plan_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    item = get_analysis(plan_id)
    if item is None:
        raise ValueError(f"Plan {plan_id} not found.")
    result = item.get("result", {})
    plan = result.get("plan", [])
    repository_path = item.get("repository_path") or result.get("repository_path")
    if not repository_path:
        raise ValueError("Analysis record is missing the repository path.")
    if not plan:
        raise ValueError("Implementation plan is empty.")
    return item, {"repository_path": repository_path, "result": result, "plan": plan}


def _extract_allowed_files(plan: dict[str, Any]) -> set[str]:
    files: set[str] = set()
    for task in plan.get("plan", []):
        for file in task.get("files", []):
            if isinstance(file, str):
                files.add(file)
    return {str(path).replace("\\", "/") for path in files}


def _normalize_rel_path(path: str) -> str:
    normalized = path.replace("\\", "/")
    if normalized.startswith("/") or normalized.startswith("../") or normalized == "..":
        raise ValueError(f"Generated file path must stay inside the approved allowlist: {path}")
    if ".." in Path(normalized).parts:
        raise ValueError(f"Generated file path must stay inside the approved allowlist: {path}")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def _validate_generated_files(allowed_files: set[str], generated: Any) -> list[dict[str, str]]:
    if not isinstance(generated, dict):
        raise ValueError("Model output must be a JSON object.")
    files = generated.get("files")
    if not isinstance(files, list):
        raise ValueError("Model output must include a JSON 'files' array.")
    validated: list[dict[str, str]] = []
    skipped: list[str] = []
    for entry in files:
        if not isinstance(entry, dict):
            continue
        file_name = entry.get("file")
        content = entry.get("content")
        if not isinstance(file_name, str) or not isinstance(content, str):
            continue
        try:
            normalized = _normalize_rel_path(file_name)
        except ValueError:
            skipped.append(str(file_name))
            continue
        if normalized not in allowed_files:
            # Try fuzzy match: basename match against allowlist
            basename = normalized.rsplit("/", 1)[-1]
            match = next((f for f in allowed_files if f.endswith("/" + basename) or f == basename), None)
            if match:
                normalized = match
            else:
                skipped.append(normalized)
                continue
        if not content.strip():
            skipped.append(normalized)
            continue
        # For Python files: reject content where function bodies have no indentation
        # (model sometimes strips all leading whitespace from code lines)
        if normalized.endswith(".py"):
            lines = content.splitlines()
            in_def = False
            indent_ok = True
            for line in lines:
                stripped = line.lstrip()
                if stripped.startswith(("def ", "class ")):
                    in_def = True
                    continue
                if in_def and stripped and not line.startswith((" ", "\t")):
                    # Non-empty line after def/class with no indentation
                    indent_ok = False
                    break
                if stripped:
                    in_def = False
            if not indent_ok:
                skipped.append(f"{normalized} [indentation stripped by model]")
                continue
        validated.append({"file": normalized, "content": content})
    if not validated:
        skipped_str = ", ".join(skipped[:5])
        raise ValueError(
            f"Model returned only files outside the approved allowlist ({skipped_str}). "
            f"Allowlist: {sorted(allowed_files)}"
        )
    return validated


def _build_prompt(item: dict[str, Any], plan: dict[str, Any], repository_path: str) -> str:
    request = item.get("result", {}).get("request", "")
    allowed_files = sorted(_extract_allowed_files(plan))
    repository = Path(repository_path)
    file_context = []
    for relative_path in allowed_files:
        full_path = repository / relative_path
        if full_path.exists() and full_path.is_file():
            file_context.append(f"FILE: {relative_path}\n```\n{full_path.read_text(encoding='utf-8', errors='ignore')}\n```\n")
    root_manifest = ["requirements.txt", "package.json", "pyproject.toml"]
    for name in root_manifest:
        candidate = repository / name
        if candidate.exists():
            file_context.append(f"FILE: {name}\n```\n{candidate.read_text(encoding='utf-8', errors='ignore')}\n```\n")
    relevant_tests = []
    # Skip adding test files to context — they're already covered by allowed_files
    # and removing them reduces prompt size for slow free-tier models
    for test_file in relevant_tests[:0]:  # disabled
        rel = test_file.relative_to(repository).as_posix()
        if rel not in allowed_files:
            file_context.append(f"TEST_FILE: {rel}\n```\n{test_file.read_text(encoding='utf-8', errors='ignore')}\n```\n")
    prompt = (
        "You are operating on an existing production-style repository.\n"
        "Modify only the files in the approved allowlist below.\n"
        "Preserve existing functionality and repository conventions.\n"
        "Do not invent APIs that do not exist.\n"
        "Do not expose secrets.\n"
        "Do not modify unrelated files.\n"
        "Return ONLY a single valid JSON object matching this schema exactly:\n"
        "{\n"
        "  \"files\": [\n"
        "    {\"file\": \"relative/path.py\", \"content\": \"complete new file contents\"}\n"
        "  ],\n"
        "  \"summary\": \"short explanation\"\n"
        "}\n"
        "CRITICAL rules:\n"
        "- The 'file' value MUST be copied EXACTLY from the approved files list below. Do not invent new paths.\n"
        "- All newlines inside 'content' values MUST be escaped as \\n.\n"
        "- All double quotes inside 'content' values MUST be escaped as \\\".\n"
        "- All backslashes inside 'content' values MUST be escaped as \\\\.\n"
        "- No raw (literal) newlines inside any JSON string value.\n"
        "- PRESERVE ALL INDENTATION. Python indentation is syntactically required. Every indented line must keep its leading spaces when escaped.\n"
        "- Example correct: 'def f():\\n    return 1\\n' (4 spaces before return, escaped as \\n    return)\n"
        "- Example WRONG: 'def f():\\nreturn 1\\n' (missing indentation — this is a syntax error)\n"
        "- No markdown fences, no prose, no text before or after the JSON.\n"
        f"The change request is:\n{request}\n\n"
        "APPROVED FILES (use these exact paths in the 'file' field):\n"
        + "\n".join(f"  - {f}" for f in allowed_files)
        + "\n\nRepository context:\n"
        f"{chr(10).join(file_context)}\n\n"
        "Only include files that actually need modification. Use complete replacement content.\n"
    )
    return prompt


def _strip_fences(raw: str) -> str:
    text = raw.strip()
    # Strip markdown fences (```json ... ``` or ``` ... ```)
    if text.startswith("```"):
        lines = text.splitlines()
        # Drop first line (``` or ```json) and last ``` line
        inner = []
        for line in lines[1:]:
            if line.strip() == "```":
                break
            inner.append(line)
        text = "\n".join(inner).strip()
    return text.strip()


def _extract_json_object(text: str) -> str:
    """Extract the outermost {...} JSON object from a potentially noisy string."""
    start = text.find("{")
    if start == -1:
        return text
    depth = 0
    in_string = False
    escape_next = False
    for i, ch in enumerate(text[start:], start):
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return text[start:]


def _remove_trailing_commas(text: str) -> str:
    """Remove trailing commas before ] or } — common LLM JSON mistake."""
    return re.sub(r",\s*([}\]])", r"\1", text)


def _parse_model_json(raw: str) -> dict[str, Any]:
    """Parse JSON from model output with multiple fallback strategies."""
    cleaned = _strip_fences(raw)
    extracted = _extract_json_object(cleaned)

    candidates = [
        cleaned,
        extracted,
        _remove_trailing_commas(extracted),
        _fix_unescaped_newlines(extracted),
        _remove_trailing_commas(_fix_unescaped_newlines(extracted)),
    ]

    for candidate in candidates:
        try:
            data = json.loads(candidate)
            if isinstance(data, dict) and "files" in data:
                return data
        except json.JSONDecodeError:
            pass

    # Final: raise with the most informative error
    try:
        json.loads(_remove_trailing_commas(extracted))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Model returned invalid JSON: {exc}") from exc
    raise ValueError("Model JSON must be an object with a 'files' field.")


def _fix_unescaped_newlines(text: str) -> str:
    """Fix unescaped newlines, tabs, AND bare double-quotes inside JSON string values.

    Walks the text character-by-character. When inside a string, any character
    that would break the JSON spec is replaced with its escape sequence.
    For an unescaped quote, we peek at the next non-whitespace character:
    if it is one of , ] } : we treat it as a legitimate closing quote;
    otherwise we escape it as \".
    """
    result = []
    in_string = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "\\" and in_string:
            # Already-escaped sequence — keep backslash + next char as-is
            result.append(ch)
            i += 1
            if i < n:
                result.append(text[i])
                i += 1
            continue
        if ch == '"':
            if in_string:
                # Peek ahead to decide: closing quote or bare quote inside value?
                j = i + 1
                while j < n and text[j] in " \t\r\n":
                    j += 1
                next_ch = text[j] if j < n else ""
                if next_ch in (",", "]", "}", ":"):
                    # Legitimate closing quote
                    in_string = False
                    result.append('"')
                else:
                    # Unescaped quote inside a string value — escape it
                    result.append('\\"')
            else:
                in_string = True
                result.append('"')
            i += 1
            continue
        if in_string:
            if ch == "\n":
                result.append("\\n")
            elif ch == "\r":
                result.append("\\r")
            elif ch == "\t":
                result.append("\\t")
            else:
                result.append(ch)
        else:
            result.append(ch)
        i += 1
    return "".join(result)


def _build_patch_data(repository_path: str, generated_files: list[dict[str, str]]) -> list[dict[str, str]]:
    repo_root = Path(repository_path)
    patch_data: list[dict[str, str]] = []
    for entry in generated_files:
        relative_path = entry["file"]
        target = repo_root / relative_path
        original = target.read_text(encoding="utf-8", errors="ignore") if target.exists() else ""
        # The JSON repair may have left \\n as literal two-char sequences.
        # Decode them back into real newlines before diffing.
        content = entry["content"]
        content = content.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")
        # Also unescape any \" that the repair introduced
        content = content.replace('\\"', '"')
        diff_lines = list(
            difflib.unified_diff(
                original.splitlines(keepends=True),
                content.splitlines(keepends=True),
                fromfile=f"a/{relative_path}" if target.exists() else "/dev/null",
                tofile=f"b/{relative_path}",
                lineterm="\n",
            )
        )
        if not diff_lines:
            raise ValueError(f"No diff generated for {relative_path}")
        diff = "".join(
            line if line.endswith("\n") else line + "\n"
            for line in diff_lines
        )
        patch_data.append({"file": relative_path, "unified_diff": diff})
    return patch_data


def generate_code_patches(plan_id: str) -> dict[str, Any]:
    # Pre-flight: check credentials are configured before doing expensive work
    provider = _llm_provider()
    if provider == "openrouter" and not _openrouter_api_key():
        raise RuntimeError("AI code generator unavailable. Ensure OPENROUTER_API_KEY is set and the OpenRouter API is reachable.")
    if provider == "gemini" and not _gemini_api_key():
        raise RuntimeError("AI code generator unavailable for provider 'gemini'. Check the provider configuration and credentials.")
    if provider == "ollama":
        # Still need to ping for ollama since there's no key to check
        try:
            _call_ollama({"model": _ollama_model(), "prompt": "ping", "stream": False})
        except Exception as exc:
            raise RuntimeError("AI code generator unavailable. Start Ollama and ensure the configured model exists.") from exc

    item, plan_context = _load_plan_context(plan_id)
    repository_path = plan_context["repository_path"]
    allowed_files = _extract_allowed_files(plan_context)
    prompt = _build_prompt(item, plan_context, repository_path)
    try:
        response_text = _call_llm(prompt)
    except Exception as exc:  # pragma: no cover - surfaced to API
        provider = _llm_provider()
        if provider == "openrouter":
            raise RuntimeError("AI code generator unavailable. Ensure OPENROUTER_API_KEY is set and the OpenRouter API is reachable.") from exc
        if provider == "ollama":
            raise RuntimeError("AI code generator unavailable. Start Ollama and ensure the configured model exists.") from exc
        raise RuntimeError(f"AI code generator unavailable for provider '{provider}'. Check the provider configuration and credentials.") from exc
    payload = _parse_model_json(response_text)
    generated_files = _validate_generated_files(allowed_files, payload)
    patch_data = _build_patch_data(repository_path, generated_files)
    return {"files": generated_files, "patch_data": patch_data, "summary": str(payload.get("summary", "Generated code changes."))}
