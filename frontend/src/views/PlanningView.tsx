import React, { useState } from "react";
import { Wrench, Play, CheckSquare, Square, Info } from "lucide-react";
import { LoadingSpinner } from "../components/LoadingSpinner";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { DemoDataBadge } from "../components/DemoDataBadge";
import type { Result, AiAnalysis } from "../types";
import { api } from "../api";

const DONE_KEY = "codeguardian.doneTasks";

interface PlanningViewProps {
  analysisId: string;
  result: Result | null;
  isDemoMode: boolean;
}

function loadDone(): Set<string> {
  try { return new Set(JSON.parse(window.localStorage.getItem(DONE_KEY) ?? "[]") as string[]); }
  catch { return new Set(); }
}
function saveDone(done: Set<string>) {
  window.localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
}

export function PlanningView({ analysisId, result, isDemoMode }: PlanningViewProps) {
  const [done, setDone] = useState<Set<string>>(loadDone);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);

  function toggleDone(task: string) {
    setDone(prev => {
      const next = new Set(prev);
      next.has(task) ? next.delete(task) : next.add(task);
      saveDone(next);
      return next;
    });
  }

  async function runAiAnalysis() {
    if (!analysisId) return;
    setAiLoading(true);
    setAiError("");
    try {
      const data = await api.aiAnalyze(analysisId);
      if (data.status === "failed" && data.error) {
        setAiError(data.error);
        return;
      }
      // Poll for completion if we have a real job_id
      if (data.job_id && data.job_id !== "n/a") {
        let polls = 0;
        const MAX_POLLS = 100;
        while (polls < MAX_POLLS) {
          const statusData = await api.aiStatus(data.job_id);
          if (statusData.status !== "running") {
            setAiAnalysis(statusData);
            break;
          }
          polls++;
          await new Promise<void>(resolve => setTimeout(resolve, 3000));
        }
        if (polls >= MAX_POLLS) {
          setAiError("AI analysis timed out after polling. Try again later.");
        }
      } else {
        // Synchronous result — job_id is "n/a" or status already complete
        const statusData = await api.aiStatus(data.job_id);
        setAiAnalysis(statusData);
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI analysis failed");
    } finally {
      setAiLoading(false);
    }
  }

  if (!result && !isDemoMode) {
    return (
      <div className="page-container">
        <EmptyState
          icon={Wrench}
          title="No analysis available"
          description="Run a repository analysis first to see the fix plan."
        />
      </div>
    );
  }

  const plan = result?.plan ?? [];

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="eyebrow">FIX PLANNING WORKSPACE</p>
          <h1>Repair Plan</h1>
          <p>{plan.length} tasks identified</p>
        </div>
        {isDemoMode && <DemoDataBadge />}
      </div>

      {/* Plan list */}
      {plan.length === 0 ? (
        <EmptyState icon={Wrench} title="No plan tasks" description="The analyzer did not generate any plan tasks for this change request." />
      ) : (
        <div className="plan-list" style={{ marginBottom: 32 }}>
          {plan.map((item, index) => (
            <div
              key={item.task}
              className="plan-item"
              style={{ opacity: done.has(item.task) ? 0.6 : 1 }}
            >
              <button
                className="plan-number"
                onClick={() => toggleDone(item.task)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggleDone(item.task); }}
                aria-label={done.has(item.task) ? `Mark task ${index + 1} incomplete` : `Mark task ${index + 1} complete`}
                aria-pressed={done.has(item.task)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-accent)", display: "flex", alignItems: "center" }}
              >
                {done.has(item.task) ? <CheckSquare size={16} /> : <Square size={16} />}
              </button>
              <div className="plan-content">
                <h3 style={{ textDecoration: done.has(item.task) ? "line-through" : "none" }}>{item.task}</h3>
                <p>{item.reason}</p>
                {item.files.length > 0 && (
                  <div className="file-pills">
                    {item.files.map(f => <code key={f}>{f}</code>)}
                  </div>
                )}
              </div>
              <span className={`risk-tag ${item.risk}`}>{item.risk}</span>
            </div>
          ))}
        </div>
      )}

      {/* Progress bar */}
      {plan.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12, color: "var(--color-text-secondary)" }}>
            <span>Progress</span>
            <span>{done.size} / {plan.length} complete</span>
          </div>
          <div style={{ height: 6, background: "var(--color-border)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", background: "var(--color-accent)", borderRadius: 3, width: `${plan.length > 0 ? (done.size / plan.length) * 100 : 0}%`, transition: "width 0.3s" }} />
          </div>
        </div>
      )}

      {/* AI Analysis section */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">AI-Assisted Analysis</span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={runAiAnalysis}
            disabled={!analysisId || aiLoading || isDemoMode}
            aria-disabled={!analysisId || aiLoading || isDemoMode}
            aria-label="Run AI analysis using Nebius AI"
          >
            {aiLoading ? <><Play size={13} className="spin" /> Running…</> : <><Play size={13} /> Run AI Analysis</>}
          </button>
        </div>

        {isDemoMode && (
          <div className="offline-banner" style={{ marginBottom: 12 }}>
            <Info size={14} />
            <span>AI analysis is not available in demo mode.</span>
          </div>
        )}

        {!isDemoMode && !analysisId && (
          <div className="offline-banner">
            <Info size={14} />
            <span>Run a repository analysis first to enable AI analysis.</span>
          </div>
        )}

        {aiLoading && <LoadingSpinner label="Running AI analysis via Nebius AI…" />}
        {aiError && (
          <div style={{ marginTop: 8 }}>
            {aiError.includes("NEBIUS_API_KEY") ? (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 16px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: "var(--radius-sm)", color: "var(--color-severity-info)", fontSize: 13 }}>
                <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>AI analysis requires <code>NEBIUS_API_KEY</code> to be set as an environment variable on the backend. Configure it to enable AI-powered fix planning.</span>
              </div>
            ) : (
              <ErrorBanner message={aiError} />
            )}
          </div>
        )}

        {aiAnalysis && !aiLoading && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "var(--color-accent)", marginBottom: 12 }}>AI analysis complete — Job ID: {aiAnalysis.job_id}</div>

            {/* Investigator */}
            {aiAnalysis.stages?.investigator?.risk_narrative && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Risk Narrative</div>
                <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{aiAnalysis.stages.investigator.risk_narrative}</p>
              </div>
            )}

            {/* Impact Analyst */}
            {aiAnalysis.stages?.impact_analyst?.impact_summary && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Impact Summary</div>
                <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{aiAnalysis.stages.impact_analyst.impact_summary}</p>
              </div>
            )}

            {/* Planner Tasks */}
            {aiAnalysis.stages?.planner?.tasks && aiAnalysis.stages.planner.tasks.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 10 }}>AI-Generated Tasks</div>
                {aiAnalysis.stages.planner.tasks.map((t, i) => (
                  <div key={i} style={{ display: "flex", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--color-border)" }}>
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 12, color: "var(--color-accent)", minWidth: 28 }}>0{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>{t.title}</div>
                      {t.description && (
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 4 }}>{t.description}</div>
                      )}
                      {t.rationale && (
                        <div style={{ fontSize: 12, color: "var(--color-text-secondary)", fontStyle: "italic" }}>{t.rationale}</div>
                      )}
                      {t.files && t.files.length > 0 && (
                        <div className="file-pills" style={{ marginTop: 6 }}>
                          {t.files.map(f => <code key={f}>{f}</code>)}
                        </div>
                      )}
                    </div>
                    {t.complexity_estimate && (
                      <span className={`risk-tag ${t.complexity_estimate}`}>{t.complexity_estimate}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Report Generator */}
            {aiAnalysis.stages?.report_generator?.executive_summary && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)", textTransform: "uppercase", marginBottom: 6 }}>Executive Summary</div>
                <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6 }}>{aiAnalysis.stages.report_generator.executive_summary}</p>
              </div>
            )}
          </div>
        )}

        {!aiAnalysis && !aiLoading && !aiError && !isDemoMode && analysisId && (
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", padding: "12px 0" }}>
            Click "Run AI Analysis" to get AI-powered task recommendations. Requires <code>NEBIUS_API_KEY</code> on the backend.
          </div>
        )}
      </div>
    </div>
  );
}
