import React, { useState } from "react";
import { Play, CheckCircle, TestTube2 } from "lucide-react";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { DemoDataBadge } from "../components/DemoDataBadge";
import { DEMO_VERIFICATION } from "../demoData";
import type { Verification } from "../types";
import type { ViewName } from "../App";
import { api } from "../api";

interface VerificationViewProps {
  analysisId: string;
  repositoryPath: string;
  verification: Verification | null;
  setVerification: (v: Verification) => void;
  isDemoMode: boolean;
  onNavigate: (view: ViewName) => void;
  onActivityLog: (type: "verification", message: string, analysisId?: string) => void;
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  TESTS_PASSED:         { label: "Passed",   cls: "severity-low" },
  TESTS_FAILED:         { label: "Failed",   cls: "severity-critical" },
  NO_TESTS_FOUND:       { label: "Not Run",  cls: "severity-medium" },
  TEST_EXECUTION_ERROR: { label: "Blocked",  cls: "severity-critical" },
  TEST_DISCOVERY_ERROR: { label: "Blocked",  cls: "severity-medium" },
};

const countLabel = (value: number | null | undefined) => value == null ? "–" : String(value);

export function VerificationView({ analysisId, repositoryPath, verification, setVerification, isDemoMode, onNavigate, onActivityLog }: VerificationViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeVerification = isDemoMode ? DEMO_VERIFICATION : verification;

  async function runVerification() {
    if (!repositoryPath) {
      setError("Repository path is required. Run an analysis first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api.verify(repositoryPath, analysisId || undefined);
      setVerification(data);
      onActivityLog("verification", `Tests ${data.status.replace(/_/g, " ")}: ${data.passed ?? 0} passed, ${data.failed ?? 0} failed`, analysisId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach verification API");
    } finally {
      setBusy(false);
    }
  }

  const statusInfo = activeVerification ? (STATUS_LABELS[activeVerification.status] ?? { label: activeVerification.status, cls: "severity-info" }) : null;

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="eyebrow">VERIFICATION CENTER</p>
          <h1>Test Suite Results</h1>
          <p>Run the repository's test suite and capture the result as evidence.</p>
        </div>
        {isDemoMode && <DemoDataBadge />}
      </div>

      <ErrorBanner message={error} />

      <div style={{ display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn btn-primary"
          onClick={isDemoMode ? undefined : runVerification}
          disabled={busy || isDemoMode || !repositoryPath}
          aria-disabled={busy || isDemoMode || !repositoryPath}
          title={isDemoMode ? "Verification not available in demo mode" : !repositoryPath ? "Run an analysis first" : undefined}
          aria-label="Run test suite"
        >
          {busy ? <><Play size={15} className="spin" /> Running…</> : <><Play size={15} /> Run Tests</>}
        </button>
        {!repositoryPath && !isDemoMode && (
          <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
            Run an analysis first to set the repository path.{" "}
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate("repository")}>Go to Repository</button>
          </div>
        )}
      </div>

      {busy && <LoadingSpinner label="Running test suite…" />}

      {!activeVerification && !busy ? (
        <EmptyState
          icon={TestTube2}
          title="No verification run yet"
          description="Click 'Run Tests' to execute the repository's test suite and capture the results."
        />
      ) : activeVerification && (
        <div>
          {/* Status card */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <TestTube2 size={28} style={{ color: "var(--color-accent)" }} aria-hidden="true" />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--color-text-primary)" }}>
                    {activeVerification.status.replace(/_/g, " ")}
                  </h2>
                  {statusInfo && (
                    <span className={`badge badge-outline ${statusInfo.cls}`}>{statusInfo.label}</span>
                  )}
                </div>
                {activeVerification.reason && (
                  <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>{activeVerification.reason}</p>
                )}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="verification-counts" style={{ marginBottom: 24 }}>
            {[
              ["Framework", activeVerification.framework ?? "–"],
              ["Passed", countLabel(activeVerification.passed)],
              ["Failed", countLabel(activeVerification.failed)],
              ["Skipped", countLabel(activeVerification.skipped)],
              ["Errors", countLabel(activeVerification.errors)],
              ["Total", countLabel(activeVerification.total)],
              ["Discovered", countLabel(activeVerification.tests_discovered)],
              ["Duration (s)", countLabel(activeVerification.duration)],
            ].map(([label, value]) => (
              <span key={label as string}>
                <small>{label}</small>
                <b style={{ color: label === "Failed" && (activeVerification.failed ?? 0) > 0 ? "var(--color-severity-critical)" : label === "Passed" && (activeVerification.passed ?? 0) > 0 ? "var(--color-accent)" : "var(--color-text-primary)" }}>
                  {value as string}
                </b>
              </span>
            ))}
          </div>

          {/* Command + working dir */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Command</div>
              <code style={{ fontSize: 13 }}>{activeVerification.command.flat().join(" ") || "Not executed"}</code>
            </div>
            <div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Working Directory</div>
              <code style={{ fontSize: 13 }}>{activeVerification.working_directory}</code>
            </div>
          </div>

          {/* Output log */}
          {(activeVerification.output ?? activeVerification.stdout ?? activeVerification.stderr) && (
            <div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 8 }}>Output Log</div>
              <pre style={{ maxHeight: 300 }}>
                {activeVerification.output ?? activeVerification.stdout ?? ""}
                {activeVerification.stderr ? `\n[STDERR]\n${activeVerification.stderr}` : ""}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
