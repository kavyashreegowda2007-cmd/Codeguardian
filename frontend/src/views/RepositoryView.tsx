import React, { useState } from "react";
import { FolderOpen, Activity, ArrowUpRight, GitBranch, FileCode2, ChevronRight, ChevronDown } from "lucide-react";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";
import type { Result } from "../types";
import type { ViewName } from "../App";
import { api } from "../api";

interface RepositoryViewProps {
  request: string;
  setRequest: (v: string) => void;
  repositoryPath: string;
  setRepositoryPath: (v: string) => void;
  result: Result | null;
  analysisId: string;
  onAnalysisComplete: (id: string, path: string, result: Result) => void;
  onNavigate: (view: ViewName) => void;
}

type GitStatus = { clean: boolean; status: string[]; diff_stat: string[] };

function buildFileTree(files: string[]): Record<string, string[]> {
  const tree: Record<string, string[]> = {};
  files.forEach(f => {
    const parts = f.split("/");
    if (parts.length === 1) {
      (tree["(root)"] = tree["(root)"] ?? []).push(f);
    } else {
      const dir = parts.slice(0, -1).join("/");
      (tree[dir] = tree[dir] ?? []).push(parts[parts.length - 1]);
    }
  });
  return tree;
}

function FileTree({ files }: { files: string[] }) {
  const tree = buildFileTree(files);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    Object.keys(tree).forEach(k => { initial[k] = true; });
    return initial;
  });
  const toggle = (dir: string) => setExpanded(p => ({ ...p, [dir]: !p[dir] }));

  return (
    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
      {Object.entries(tree).map(([dir, dirFiles]) => (
        <div key={dir}>
          <button
            onClick={() => toggle(dir)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggle(dir); }}
            style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary)", padding: "4px 0", width: "100%", textAlign: "left" }}
            aria-expanded={expanded[dir]}
          >
            {expanded[dir] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <FolderOpen size={12} style={{ color: "var(--color-severity-medium)" }} />
            {dir}
          </button>
          {expanded[dir] && (
            <div style={{ marginLeft: 20 }}>
              {dirFiles.map(f => (
                <div key={f} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", color: "var(--color-text-primary)" }}>
                  <FileCode2 size={11} style={{ color: "var(--color-text-secondary)", flexShrink: 0 }} />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function RepositoryView({ request, setRequest, repositoryPath, setRepositoryPath, result, analysisId, onAnalysisComplete, onNavigate }: RepositoryViewProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);

  async function analyze() {
    setBusy(true);
    setError("");
    setGitStatus(null);
    try {
      const data = await api.analyze(repositoryPath, request);
      window.localStorage.setItem("codeguardian.analysisId", data.id);
      onAnalysisComplete(data.id, data.repository_path, data.result);

      // Fetch git status
      try {
        const gs = await api.gitStatus(repositoryPath);
        setGitStatus(gs);
      } catch { /* git status is optional */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the API");
    } finally {
      setBusy(false);
    }
  }

  const canAnalyze = !busy && request.trim().length >= 5 && repositoryPath.trim().length > 0;

  return (
    <div className="page-container">
      <div className="page-header">
        <p className="eyebrow">REPOSITORY EXPLORER</p>
        <h1>Configure Analysis</h1>
        <p>Provide a repository path and describe the change you want to analyze.</p>
      </div>

      <ErrorBanner message={error} />

      {/* Input form */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="form-group">
          <label className="form-label" htmlFor="repo-request">Change Request</label>
          <input
            id="repo-request"
            className="form-input"
            value={request}
            onChange={e => setRequest(e.target.value)}
            placeholder="e.g. Add phone-number authentication"
            aria-required="true"
            minLength={5}
            maxLength={500}
          />
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 6, fontFamily: "'DM Mono', monospace" }}>
            Describe the maintenance task in plain English
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="repo-path">Repository Path</label>
          <input
            id="repo-path"
            className="form-input"
            value={repositoryPath}
            onChange={e => setRepositoryPath(e.target.value)}
            placeholder="https://github.com/owner/repo  or  sample-project  or  /local/path"
            aria-required="true"
          />
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 6, fontFamily: "'DM Mono', monospace" }}>
            Public GitHub HTTPS URL or local directory path
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={analyze}
          disabled={!canAnalyze}
          aria-disabled={!canAnalyze}
          aria-label="Run repository analysis"
        >
          {busy ? (
            <><Activity size={16} className="spin" aria-hidden="true" /> Analyzing…</>
          ) : (
            <><Activity size={16} aria-hidden="true" /> Analyze Change <ArrowUpRight size={15} aria-hidden="true" /></>
          )}
        </button>
        {busy && <LoadingSpinner label="Analyzing repository, this may take a moment…" />}
        {!canAnalyze && !busy && (
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--color-text-secondary)" }}>
            {request.trim().length < 5 && <div>• Change request must be at least 5 characters</div>}
            {repositoryPath.trim().length === 0 && <div>• Repository path is required</div>}
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <>
          {/* Stats */}
          <div className="grid-three" style={{ marginBottom: 24 }}>
            <div className="card">
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 8 }}>Files Scanned</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text-primary)" }}>{result.evidence.files.length}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 8 }}>Symbols Indexed</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text-primary)" }}>{result.evidence.symbols.length}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 11, fontFamily: "'DM Mono', monospace", color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 8 }}>Dependencies</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "var(--color-text-primary)" }}>{result.dependencies.length}</div>
            </div>
          </div>

          {/* File tree */}
          {result.evidence.files.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title">Scanned Files</span>
                <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{result.evidence.files.length} files</span>
              </div>
              <FileTree files={result.evidence.files} />
            </div>
          )}

          {/* Git status */}
          {gitStatus && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="card-header">
                <span className="card-title"><GitBranch size={14} style={{ display: "inline", marginRight: 6 }} />Git Status</span>
                <span className={`badge badge-outline ${gitStatus.clean ? "severity-low" : "severity-medium"}`}>
                  {gitStatus.clean ? "Clean" : `${gitStatus.status.length} changes`}
                </span>
              </div>
              {gitStatus.status.length > 0 ? (
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
                  {gitStatus.status.map((s, i) => <div key={i} style={{ color: "var(--color-text-secondary)", padding: "2px 0" }}>{s}</div>)}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>Working tree is clean.</div>
              )}
            </div>
          )}

          {/* Navigate to next steps */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={() => onNavigate("impact")}>
              View Impact Graph <ArrowUpRight size={15} />
            </button>
            <button className="btn btn-secondary" onClick={() => onNavigate("findings")}>
              Review Findings
            </button>
          </div>
        </>
      )}
    </div>
  );
}
