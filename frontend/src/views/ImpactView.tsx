import React, { useEffect, useState } from "react";
import { GitBranch, FileCode2, Terminal, ShieldCheck } from "lucide-react";
import { DependencyGraph } from "../components/DependencyGraph";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { DemoDataBadge } from "../components/DemoDataBadge";
import { DEMO_GRAPH_NODES, DEMO_GRAPH_EDGES } from "../demoData";
import type { GraphNode, GraphEdge, Result } from "../types";
import { api } from "../api";

interface ImpactViewProps {
  analysisId: string;
  result: Result | null;
  isDemoMode: boolean;
}

type NodeType = "all" | "source" | "test" | "database" | "config";

export function ImpactView({ analysisId, result, isDemoMode }: ImpactViewProps) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<NodeType>("all");

  useEffect(() => {
    if (isDemoMode) {
      setNodes(DEMO_GRAPH_NODES);
      setEdges(DEMO_GRAPH_EDGES);
      return;
    }
    if (!analysisId) return;
    setLoading(true);
    setError("");
    api.getGraph(analysisId)
      .then(data => {
        setNodes(data.nodes);
        setEdges(data.edges);
      })
      .catch(e => setError(e instanceof Error ? e.message : "Failed to load graph"))
      .finally(() => setLoading(false));
  }, [analysisId, isDemoMode]);

  const filteredNodes = typeFilter === "all" ? nodes : nodes.filter(n => n.type === typeFilter);
  const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
  const filteredEdges = edges.filter(e => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target));

  if (!analysisId && !isDemoMode) {
    return (
      <div className="page-container">
        <EmptyState
          icon={GitBranch}
          title="No analysis available"
          description="Run a repository analysis first to view the dependency graph."
        />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="eyebrow">IMPACT ANALYSIS</p>
          <h1>Dependency Graph</h1>
          {result && <p>{result.impact_message}</p>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isDemoMode && <DemoDataBadge />}
          {result && (
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              Confidence: <strong style={{ color: "var(--color-accent)" }}>{result.confidence}%</strong>
            </span>
          )}
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* Type filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {(["all", "source", "test", "database", "config"] as NodeType[]).map(t => (
          <button
            key={t}
            className={`btn btn-sm ${typeFilter === t ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTypeFilter(t)}
            aria-pressed={typeFilter === t}
            style={{ textTransform: "capitalize" }}
          >
            {t === "all" ? `All (${nodes.length})` : `${t} (${nodes.filter(n => n.type === t).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSpinner label="Loading dependency graph…" />
      ) : (
        <div style={{ marginBottom: 32 }}>
          <DependencyGraph nodes={filteredNodes} edges={filteredEdges} height={500} />
        </div>
      )}

      {result && (
        <div className="grid-two" style={{ gap: 20 }}>
          {/* Affected files */}
          <div className="card">
            <div className="card-header">
              <span className="card-title"><FileCode2 size={14} style={{ display: "inline", marginRight: 6 }} />Affected Files</span>
              <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>{result.affected_files.length}</span>
            </div>
            {result.affected_files.length === 0 ? (
              <p style={{ color: "var(--color-text-secondary)", fontSize: 13 }}>None identified.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
                {result.affected_files.map(f => (
                  <code key={f} style={{ fontSize: 12 }}>{f}</code>
                ))}
              </div>
            )}
          </div>

          {/* Evidence panel */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">Evidence Panel</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 13 }}>
              <div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Affected Components ({result.affected_components.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.affected_components.length === 0 ? <span style={{ color: "var(--color-text-secondary)" }}>None</span> :
                    result.affected_components.map(c => <code key={c}>{c}</code>)}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>API Routes ({result.affected_apis.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.affected_apis.length === 0 ? <span style={{ color: "var(--color-text-secondary)" }}>None</span> :
                    result.affected_apis.map(a => <code key={a}>{a}</code>)}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Database ({result.database_components.length})</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {result.database_components.length === 0 ? <span style={{ color: "var(--color-text-secondary)" }}>None</span> :
                    result.database_components.map(d => <code key={d}>{d}</code>)}
                </div>
              </div>
              {result.security_risks.length > 0 && (
                <div>
                  <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-severity-high)", textTransform: "uppercase", marginBottom: 6 }}>Security Risks ({result.security_risks.length})</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {result.security_risks.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--color-severity-high)", display: "flex", gap: 8 }}>
                        <ShieldCheck size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                        {r}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
