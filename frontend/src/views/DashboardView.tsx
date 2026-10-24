import React, { useEffect, useState } from "react";
import { LayoutDashboard, AlertTriangle, GitBranch, CheckCircle, Plus, WifiOff } from "lucide-react";
import { SeverityBadge } from "../components/SeverityBadge";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { DemoDataBadge } from "../components/DemoDataBadge";
import type { FindingsSummary, Result, Verification } from "../types";
import type { ViewName } from "../App";
import { api } from "../api";

interface DashboardViewProps {
  analysisId: string;
  result: Result | null;
  verification: Verification | null;
  repositoryPath: string;
  isDemoMode: boolean;
  backendOnline: boolean | null;
  onNavigate: (view: ViewName) => void;
}

export function DashboardView({ analysisId, result, verification, repositoryPath, isDemoMode, backendOnline, onNavigate }: DashboardViewProps) {
  const [findingsSummary, setFindingsSummary] = useState<FindingsSummary | null>(null);
  const [loadingFindings, setLoadingFindings] = useState(false);
  const [findingsError, setFindingsError] = useState("");

  useEffect(() => {
    if (!analysisId || isDemoMode) return;
    setLoadingFindings(true);
    setFindingsError("");
    api.getFindings(analysisId)
      .then(data => setFindingsSummary(data.summary))
      .catch(e => setFindingsError(e instanceof Error ? e.message : "Failed to load findings"))
      .finally(() => setLoadingFindings(false));
  }, [analysisId, isDemoMode]);

  const SEVERITY_KEYS: (keyof FindingsSummary)[] = ["critical", "high", "medium", "low", "info"];

  const demoSummary: FindingsSummary = { critical: 0, high: 1, medium: 1, low: 1, info: 0 };
  const summary = isDemoMode ? demoSummary : findingsSummary;

  if (backendOnline === false && !isDemoMode) {
    return (
      <div className="page-container">
        <div className="offline-banner" role="alert">
          <WifiOff size={16} aria-hidden="true" />
          <span>Backend is offline. Start the CodeGuardian backend to use the dashboard.</span>
        </div>
        <EmptyState
          icon={LayoutDashboard}
          title="Backend Unavailable"
          description="The CodeGuardian API server is not reachable. Please start the backend and refresh."
          action={<button className="btn btn-secondary" onClick={() => onNavigate("landing")}>Return to Home</button>}
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="eyebrow">DASHBOARD</p>
          <h1 style={{ marginBottom: 4 }}>Analysis Overview</h1>
          {repositoryPath && <p style={{ color: "var(--color-text-secondary)", fontSize: 13, fontFamily: "'DM Mono', monospace" }}>{repositoryPath}</p>}
        </div>
        {isDemoMode && <DemoDataBadge />}
      </div>

      {/* Backend health */}
      {backendOnline !== null && (
        <div
          className={backendOnline ? "approval-note" : "offline-banner"}
          style={{ marginBottom: 20 }}
          aria-live="polite"
        >
          {backendOnline
            ? <><CheckCircle size={15} aria-hidden="true" /> <span>Backend Online</span></>
            : <><WifiOff size={15} aria-hidden="true" /> <span>Backend Offline — some features unavailable</span></>
          }
        </div>
      )}

      {!result ? (
        <EmptyState
          icon={LayoutDashboard}
          title="No analysis yet"
          description="Run your first analysis to see findings, impact data, and a fix plan here."
          action={
            <button className="btn btn-primary" onClick={() => onNavigate("repository")}>
              <Plus size={15} aria-hidden="true" />
              Start Analysis
            </button>
          }
        />
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid-four" style={{ marginBottom: 24 }}>
            {[
              { label: "Affected Files", value: result.affected_files.length, color: "var(--color-severity-low)" },
              { label: "Components", value: result.affected_components.length, color: "var(--color-severity-info)" },
              { label: "Dependencies", value: result.dependencies.length, color: "var(--color-severity-medium)" },
              { label: "Confidence", value: `${result.confidence}%`, color: "var(--color-accent)" },
            ].map(s => (
              <div key={s.label} className="card" style={{ borderTop: `3px solid ${s.color}` }}>
                <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 8 }}>{s.label}</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text-primary)", letterSpacing: "-.02em" }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Findings by severity */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Findings by Severity</span>
              <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("findings")}>View All</button>
            </div>
            {loadingFindings ? (
              <LoadingSpinner label="Loading findings…" />
            ) : findingsError ? (
              <ErrorBanner message={findingsError} />
            ) : summary ? (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {SEVERITY_KEYS.map(k => (
                  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", padding: "12px 20px", background: "var(--color-bg-secondary)", borderRadius: "var(--radius-sm)", minWidth: 80 }}>
                    <SeverityBadge severity={k} />
                    <span style={{ fontSize: 22, fontWeight: 800, color: "var(--color-text-primary)" }}>{summary[k]}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Impact summary */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">Impact Summary</span>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{result.impact_message}</span>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--color-text-secondary)" }}>
              <span>APIs: <strong style={{ color: "var(--color-text-primary)" }}>{result.affected_apis.length}</strong></span>
              <span>Database: <strong style={{ color: "var(--color-text-primary)" }}>{result.database_components.length}</strong></span>
              <span>Tests: <strong style={{ color: "var(--color-text-primary)" }}>{result.tests.length}</strong></span>
              <span>Security: <strong style={{ color: result.security_risks.length > 0 ? "var(--color-severity-high)" : "var(--color-text-primary)" }}>{result.security_risks.length}</strong></span>
            </div>
          </div>

          {/* Verification status */}
          {verification && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title">Last Verification</span>
                <span
                  className={`badge badge-outline ${
                    verification.status === "TESTS_PASSED" ? "severity-low" :
                    verification.status === "TESTS_FAILED" ? "severity-critical" :
                    "severity-medium"
                  }`}
                >
                  {verification.status.replace(/_/g, " ")}
                </span>
              </div>
              <div style={{ display: "flex", gap: 20, fontSize: 13, color: "var(--color-text-secondary)" }}>
                <span>Passed: <strong style={{ color: "var(--color-accent)" }}>{verification.passed ?? "–"}</strong></span>
                <span>Failed: <strong style={{ color: "var(--color-severity-critical)" }}>{verification.failed ?? "–"}</strong></span>
                <span>Total: <strong style={{ color: "var(--color-text-primary)" }}>{verification.total ?? "–"}</strong></span>
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div>
            <p className="eyebrow" style={{ marginBottom: 16 }}>QUICK ACTIONS</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { label: "New Analysis", view: "repository" as ViewName, icon: <Plus size={15} /> },
                { label: "Impact Graph", view: "impact" as ViewName, icon: <GitBranch size={15} /> },
                { label: "Review Findings", view: "findings" as ViewName, icon: <AlertTriangle size={15} /> },
                { label: "Run Verification", view: "verification" as ViewName, icon: <CheckCircle size={15} /> },
              ].map(a => (
                <button
                  key={a.view}
                  className="btn btn-secondary"
                  onClick={() => onNavigate(a.view)}
                  aria-label={a.label}
                >
                  {a.icon}
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
