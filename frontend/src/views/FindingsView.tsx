import React, { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Search } from "lucide-react";
import { SeverityBadge } from "../components/SeverityBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { DemoDataBadge } from "../components/DemoDataBadge";
import { DEMO_FINDINGS } from "../demoData";
import type { Finding, FindingsSummary } from "../types";
import { api } from "../api";

const SEVERITY_KEYS: (keyof FindingsSummary)[] = ["critical", "high", "medium", "low", "info"];

interface FindingsViewProps {
  analysisId: string;
  isDemoMode: boolean;
}

export function FindingsView({ analysisId, isDemoMode }: FindingsViewProps) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [summary, setSummary] = useState<FindingsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isDemoMode) {
      setFindings(DEMO_FINDINGS);
      const demoSummary: FindingsSummary = { critical: 0, high: 1, medium: 1, low: 1, info: 0 };
      setSummary(demoSummary);
      return;
    }
    if (!analysisId) return;
    setLoading(true);
    setError("");
    api.getFindings(analysisId)
      .then(data => {
        setFindings(data.findings);
        setSummary(data.summary);
      })
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load findings"))
      .finally(() => setLoading(false));
  }, [analysisId, isDemoMode]);

  const categories = ["all", ...Array.from(new Set(findings.map(f => f.category)))];

  const filtered = findings.filter(f => {
    const matchesSeverity = severityFilter === "all" || f.severity === severityFilter;
    const matchesCategory = categoryFilter === "all" || f.category === categoryFilter;
    const q = search.toLowerCase();
    const matchesSearch = !q || f.title.toLowerCase().includes(q) || f.description.toLowerCase().includes(q) || (f.file ?? "").toLowerCase().includes(q);
    return matchesSeverity && matchesCategory && matchesSearch;
  });

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!analysisId && !isDemoMode) {
    return (
      <div className="page-container">
        <EmptyState
          icon={AlertTriangle}
          title="No analysis available"
          description="Run a repository analysis to discover findings."
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="eyebrow">FINDINGS EXPLORER</p>
          <h1>Security &amp; Quality Findings</h1>
        </div>
        {isDemoMode && <DemoDataBadge />}
      </div>

      <ErrorBanner message={error} />

      {/* Summary bar */}
      {summary && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {SEVERITY_KEYS.map(k => (
            <button
              key={k}
              className={`btn btn-sm ${severityFilter === k ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setSeverityFilter(prev => prev === k ? "all" : k)}
              aria-pressed={severityFilter === k}
            >
              <SeverityBadge severity={k} />
              <span style={{ marginLeft: 6 }}>{summary[k]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-secondary)", pointerEvents: "none" }} />
          <input
            className="form-input"
            style={{ paddingLeft: 32 }}
            placeholder="Search findings…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search findings"
          />
        </div>
        <select
          className="form-select"
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
          style={{ width: "auto" }}
        >
          {categories.map(c => <option key={c} value={c}>{c === "all" ? "All Categories" : c}</option>)}
        </select>
        {(severityFilter !== "all" || categoryFilter !== "all" || search) && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setSeverityFilter("all"); setCategoryFilter("all"); setSearch(""); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <LoadingSpinner label="Loading findings…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title={findings.length === 0 ? "No findings" : "No findings match filters"}
          description={findings.length === 0 ? "The deterministic analyzer found no issues in this repository." : "Try adjusting severity, category, or search filters."}
        />
      ) : (
        <div className="table-wrap">
          <table aria-label="Findings table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Severity</th>
                <th>Category</th>
                <th>Title</th>
                <th>File</th>
                <th>Confidence</th>
                <th>Source</th>
                <th aria-label="Expand"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <React.Fragment key={f.id}>
                  <tr>
                    <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--color-text-secondary)" }}>{f.id}</td>
                    <td><SeverityBadge severity={f.severity} /></td>
                    <td style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{f.category}</td>
                    <td style={{ fontSize: 13, fontWeight: 600 }}>{f.title}</td>
                    <td style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--color-text-secondary)" }}>{f.file ?? "—"}{f.line != null ? `:${f.line}` : ""}</td>
                    <td style={{ fontSize: 12 }}>{Math.round(f.confidence * 100)}%</td>
                    <td>
                      <span className={`badge badge-outline ${f.source === "deterministic" ? "severity-low" : "severity-info"}`} style={{ fontSize: 9 }}>
                        {f.source}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleExpanded(f.id)}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggleExpanded(f.id); }}
                        aria-expanded={expanded.has(f.id)}
                        aria-label={`${expanded.has(f.id) ? "Collapse" : "Expand"} finding ${f.id}`}
                      >
                        {expanded.has(f.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                  </tr>
                  {expanded.has(f.id) && (
                    <tr>
                      <td colSpan={8} style={{ background: "var(--color-bg-secondary)", padding: "16px 20px" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
                          <div>
                            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Description</div>
                            <p style={{ color: "var(--color-text-primary)", lineHeight: 1.6 }}>{f.description}</p>
                          </div>
                          {f.evidence && (
                            <div>
                              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Evidence</div>
                              <code style={{ display: "block", padding: "8px 12px", background: "var(--color-bg-primary)", borderRadius: 4, fontSize: 12 }}>{f.evidence}</code>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 20, fontSize: 12, color: "var(--color-text-secondary)" }}>
                            {f.file && <span>File: <strong style={{ color: "var(--color-text-primary)", fontFamily: "'DM Mono', monospace" }}>{f.file}{f.line != null ? `:${f.line}` : ""}</strong></span>}
                            <span>Source: <strong style={{ color: "var(--color-text-primary)" }}>{f.source === "deterministic" ? "Deterministic analyzer" : "AI analysis"}</strong></span>
                            <span>Confidence: <strong style={{ color: "var(--color-text-primary)" }}>{Math.round(f.confidence * 100)}%</strong></span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
