import React, { useState } from "react";
import { FileDiff, Check, X, Zap, ShieldCheck, Info } from "lucide-react";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { DemoDataBadge } from "../components/DemoDataBadge";
import type { ImplementationResult, Result } from "../types";
import { api } from "../api";

interface PatchViewProps {
  analysisId: string;
  result: Result | null;
  implementation: ImplementationResult | null;
  setImplementation: (impl: ImplementationResult | null) => void;
  isDemoMode: boolean;
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre style={{ margin: 0, padding: 0, background: "transparent" }}>
      {lines.map((line, i) => {
        const isAdd = line.startsWith("+") && !line.startsWith("+++");
        const isRemove = line.startsWith("-") && !line.startsWith("---");
        const isHeader = line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++");
        return (
          <div
            key={i}
            style={{
              padding: "1px 8px",
              background: isAdd ? "rgba(0,255,136,0.1)" : isRemove ? "rgba(239,68,68,0.1)" : isHeader ? "rgba(99,102,241,0.1)" : "transparent",
              color: isAdd ? "var(--color-accent)" : isRemove ? "var(--color-severity-critical)" : isHeader ? "var(--color-severity-info)" : "var(--color-text-secondary)",
              fontFamily: "'DM Mono', monospace",
              fontSize: 12,
              lineHeight: 1.6,
              borderLeft: isAdd ? "2px solid var(--color-accent)" : isRemove ? "2px solid var(--color-severity-critical)" : "2px solid transparent",
            }}
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function PatchView({ analysisId, result, implementation, setImplementation, isDemoMode }: PatchViewProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [approvedMsg, setApprovedMsg] = useState("");
  const [pollMsg, setPollMsg] = useState("");

  async function approveImplementation() {
    if (!analysisId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.implement({ analysis_id: analysisId, approved: true });
      setImplementation(data);
      setApprovedMsg("Manifest approved. No files were modified yet — use Generate AI Patches to produce actual code changes.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not approve");
    } finally {
      setLoading(false);
    }
  }

  async function generatePatches() {
    if (!analysisId) return;
    setLoading(true);
    setError("");
    setApprovedMsg("");
    setPollMsg("Starting patch generation…");
    try {
      const job = await api.generatePatches(analysisId);
      if (job.status === "failed") {
        setError("Patch generation failed to start.");
        setPollMsg("");
        return;
      }
      let polls = 0;
      while (polls < 120) {
        await new Promise<void>(r => setTimeout(r, 5000));
        polls++;
        setPollMsg(`Waiting for NVIDIA Nemotron model… (${polls * 5}s elapsed, free tier takes 3–5 min)`);
        const status = await api.patchStatus(job.patch_job_id);
        if (status.status === "completed") {
          setImplementation({
            status: "implementation_complete",
            message: status.summary ?? "Patches generated.",
            patch_data: status.patch_data ?? [],
            files_changed: (status.patch_data ?? []).map(p => p.file),
          } as ImplementationResult);
          setPollMsg("");
          return;
        }
        if (status.status === "failed") {
          setError(status.error ?? "Patch generation failed.");
          setPollMsg("");
          return;
        }
      }
      setError("Patch generation timed out after 10 minutes.");
      setPollMsg("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate patches");
      setPollMsg("");
    } finally {
      setLoading(false);
    }
  }

  function rejectPatch() {
    setImplementation(null);
    setApprovedMsg("");
  }

  if (!analysisId && !isDemoMode) {
    return (
      <div className="page-container">
        <EmptyState
          icon={FileDiff}
          title="No analysis available"
          description="Run a repository analysis to generate and review patches."
        />
      </div>
    );
  }

  const patches = implementation?.patch_data ?? [];

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="eyebrow">PATCH REVIEW</p>
          <h1>Code Patches</h1>
          <p>Patches require explicit approval before any file is modified.</p>
        </div>
        {isDemoMode && <DemoDataBadge />}
      </div>

      {/* Approval notice */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "var(--radius-sm)", marginBottom: 24, color: "var(--color-severity-info)", fontSize: 13 }}>
        <ShieldCheck size={15} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>Patches require explicit approval before any file is modified. Review each diff carefully before approving.</span>
      </div>

      <ErrorBanner message={error} />
      {error && (
        <button onClick={() => setError("")} style={{ marginBottom: 12, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", fontSize: 12, textDecoration: "underline" }}>
          Dismiss
        </button>
      )}
      {pollMsg && (
        <div style={{ marginBottom: 16, fontSize: 13, color: "var(--color-text-secondary)", fontFamily: "'DM Mono', monospace" }}>
          ⏳ {pollMsg}
        </div>
      )}
      {approvedMsg && (
        <div className="approval-note" style={{ marginBottom: 20 }}>
          <Check size={15} />
          <span>{approvedMsg}</span>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <button
          className="btn btn-secondary"
          onClick={approveImplementation}
          disabled={!analysisId || loading || isDemoMode}
          aria-disabled={!analysisId || loading || isDemoMode}
          aria-label="Approve manifest"
        >
          <Check size={15} />
          {implementation?.status === "approved_manifest" ? "Manifest Approved" : "Approve Manifest"}
        </button>
        <button
          className="btn btn-primary"
          onClick={generatePatches}
          disabled={!analysisId || loading || isDemoMode}
          aria-disabled={!analysisId || loading || isDemoMode}
          aria-label="Generate AI patches"
        >
          <Zap size={15} />
          Generate AI Patches
        </button>
        {patches.length > 0 && (
          <button
            className="btn btn-danger"
            onClick={rejectPatch}
            aria-label="Reject and clear patches"
          >
            <X size={15} />
            Reject
          </button>
        )}
      </div>

      {isDemoMode && (
        <div className="offline-banner" style={{ marginBottom: 20 }}>
          <Info size={14} />
          <span>Patch generation is not available in demo mode. Run a real analysis to generate code patches.</span>
        </div>
      )}

      {loading && <LoadingSpinner label="Generating patches via NVIDIA Nemotron… (free tier can take 3–5 min, please wait)" />}

      {/* Patch list */}
      {patches.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {patches.map((patch, i) => (
            <div key={i} className="card">
              <div className="card-header">
                <span className="card-title" style={{ fontFamily: "'DM Mono', monospace", fontSize: 13 }}>{patch.file}</span>
                <span className="badge badge-outline severity-low" style={{ fontSize: 9 }}>PATCH {i + 1}</span>
              </div>
              <div style={{ background: "var(--color-bg-secondary)", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)", overflow: "hidden", maxHeight: 400, overflowY: "auto" }}>
                <DiffView diff={patch.unified_diff} />
              </div>
            </div>
          ))}
        </div>
      ) : !loading && !isDemoMode && (
        <div className="card" style={{ textAlign: "center", padding: "48px 20px" }}>
          <FileDiff size={28} style={{ margin: "0 auto 12px", color: "var(--color-text-secondary)" }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8 }}>No patches generated yet</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", maxWidth: 400, margin: "0 auto 20px" }}>
            Click "Generate AI Patches" to use the AI code generator. This requires NEBIUS_API_KEY to be configured on the backend.
          </div>
        </div>
      )}

      {/* Related findings */}
      {result && result.security_risks.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-header">
            <span className="card-title">Related Security Findings</span>
          </div>
          {result.security_risks.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--color-border)", fontSize: 13 }}>
              <span className="badge badge-outline severity-high" style={{ flexShrink: 0 }}>RISK</span>
              <span style={{ color: "var(--color-text-primary)" }}>{r}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
