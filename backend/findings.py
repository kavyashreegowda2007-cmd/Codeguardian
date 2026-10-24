"""Structured findings schema and extraction from ImpactResult dicts."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


VALID_SEVERITIES = {"critical", "high", "medium", "low", "info"}


@dataclass
class Finding:
    id: str
    severity: str       # critical | high | medium | low | info
    category: str
    title: str
    description: str
    file: str
    line: int | None
    evidence: str
    confidence: float
    source: str         # "deterministic" | "ai"


# ---------------------------------------------------------------------------
# ID generation
# ---------------------------------------------------------------------------

def _stable_id(file: str, title: str) -> str:
    """Return a stable, compact hex identifier for a finding."""
    return f"F-{hash(file + title) & 0xFFFFFF:06X}"


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def _parse_security_risk(raw: str) -> Finding:
    """Convert a security_risks string like 'path/file.py:10: message' to Finding."""
    # Format: "file:line: message"  (line is optional)
    parts = raw.split(":", 2)
    file_path = parts[0].strip() if parts else raw
    line: int | None = None
    description = raw

    if len(parts) >= 3:
        try:
            line = int(parts[1].strip())
            description = parts[2].strip()
        except ValueError:
            pass
    elif len(parts) == 2:
        description = parts[1].strip()

    title = description[:80] if len(description) > 80 else description

    return Finding(
        id=_stable_id(file_path, title),
        severity="high",
        category="security",
        title=title,
        description=description,
        file=file_path,
        line=line,
        evidence=raw,
        confidence=0.85,
        source="deterministic",
    )


def extract_findings_from_analysis(result: dict[str, Any]) -> list[Finding]:
    """Convert an ImpactResult dict into a list of Finding objects.

    Covers:
    - security_risks  → severity=high, category=security, source=deterministic
    - missing test coverage  → severity=medium, category=testing
    - broken/missing imports (files with import errors)  → severity=high, category=imports
    """
    findings: list[Finding] = []

    # --- 1. Security risks (deterministic) -----------------------------------
    for raw in result.get("security_risks", []):
        if isinstance(raw, str) and raw.strip():
            findings.append(_parse_security_risk(raw))

    # --- 2. Missing test coverage --------------------------------------------
    affected_files: list[str] = result.get("affected_files", [])
    tests: list[str] = result.get("tests", [])
    evidence_data: dict[str, Any] = result.get("evidence", {})
    all_files: list[str] = evidence_data.get("files", [])

    # Files that are implementation (non-test) and have no corresponding test
    test_set = set(tests)
    for file_path in affected_files:
        if file_path in test_set:
            continue
        # Skip config / deps / docs
        lower = file_path.lower()
        if any(
            lower.endswith(ext)
            for ext in (".md", ".txt", ".json", ".toml", ".yaml", ".yml", ".sql")
        ):
            continue
        if any(seg in lower for seg in ("config", "requirements", "package")):
            continue

        # Look for a corresponding test file
        stem = file_path.replace("\\", "/").rsplit(".", 1)[0]
        basename = stem.rsplit("/", 1)[-1]
        has_test = any(
            f"test_{basename}" in t or f"{basename}_test" in t
            for t in test_set
        )
        if not has_test:
            title = f"No test coverage for {file_path}"
            findings.append(
                Finding(
                    id=_stable_id(file_path, title),
                    severity="medium",
                    category="testing",
                    title=title,
                    description=(
                        f"The file '{file_path}' is affected by this change "
                        "but has no corresponding test file detected in the repository."
                    ),
                    file=file_path,
                    line=None,
                    evidence=f"Affected file: {file_path}; test files found: {len(test_set)}",
                    confidence=0.7,
                    source="deterministic",
                )
            )

    # --- 3. Import issues (broken/missing imports) ---------------------------
    imports: dict[str, list[str]] = evidence_data.get("imports", {})
    all_files_set = set(all_files)

    for source_file, imported_modules in imports.items():
        if source_file not in set(affected_files):
            continue
        for module in imported_modules:
            # Convert module path to relative file path
            candidate = module.replace(".", "/") + ".py"
            candidate_init = module.replace(".", "/") + "/__init__.py"
            if (
                module.startswith(".")
                or "/" in module
                or candidate in all_files_set
                or candidate_init in all_files_set
                or "." not in module  # stdlib / bare names
            ):
                continue
            # Looks like a relative import that resolves to a project file
            # but the file is not found — flag it
            title = f"Potentially unresolved import '{module}' in {source_file}"
            # Avoid duplicates
            finding_id = _stable_id(source_file, title)
            if any(f.id == finding_id for f in findings):
                continue
            findings.append(
                Finding(
                    id=finding_id,
                    severity="high",
                    category="imports",
                    title=title,
                    description=(
                        f"The file '{source_file}' imports '{module}' "
                        "which could not be resolved to a file in this repository. "
                        "This may indicate a missing dependency or broken import path."
                    ),
                    file=source_file,
                    line=None,
                    evidence=f"Import '{module}' in '{source_file}' has no matching file in the repository.",
                    confidence=0.6,
                    source="deterministic",
                )
            )

    return findings


# ---------------------------------------------------------------------------
# Serialisation
# ---------------------------------------------------------------------------

def findings_to_dict(findings: list[Finding]) -> list[dict[str, Any]]:
    """Serialise a list of Finding dataclass instances to plain dicts."""
    return [asdict(f) for f in findings]
