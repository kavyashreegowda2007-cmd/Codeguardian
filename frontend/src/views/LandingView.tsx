import React from "react";
import { ShieldCheck, GitBranch, Search, Zap, CheckCircle, ArrowRight, Code2, Database, Cpu, FileCode2 } from "lucide-react";
import type { ViewName } from "../App";

interface LandingViewProps {
  onNavigate: (view: ViewName) => void;
  onDemoMode: () => void;
}

const WORKFLOW_STEPS = [
  { icon: <GitBranch size={18} />, label: "Connect", desc: "Point to a repository" },
  { icon: <Search size={18} />, label: "Inspect", desc: "Parse files and symbols" },
  { icon: <Code2 size={18} />, label: "Analyze", desc: "Build dependency graph" },
  { icon: <Zap size={18} />, label: "Fix", desc: "Propose targeted patches" },
  { icon: <CheckCircle size={18} />, label: "Verify", desc: "Run the test suite" },
];

const TECH_STACK = [
  { icon: <Cpu size={15} />, name: "FastAPI", desc: "Python backend API" },
  { icon: <FileCode2 size={15} />, name: "React + TypeScript", desc: "Frontend UI" },
  { icon: <Database size={15} />, name: "SQLite", desc: "Local analysis storage" },
  { icon: <Code2 size={15} />, name: "Python AST", desc: "Static code analysis" },
  { icon: <ShieldCheck size={15} />, name: "Nebius AI Studio", desc: "AI model gateway (requires NEBIUS_API_KEY)" },
  { icon: <Cpu size={15} />, name: "NVIDIA LLaMA", desc: "Code reasoning model (requires credentials)" },
];

export function LandingView({ onNavigate, onDemoMode }: LandingViewProps) {
  return (
    <div className="page-container">
      {/* Hero */}
      <section style={{ padding: "80px 0 60px", maxWidth: 760 }}>
        <p className="eyebrow">AI CODE IMPACT &amp; REPAIR AGENT</p>
        <h1 style={{ fontSize: "clamp(36px, 5vw, 60px)", lineHeight: 1.05, letterSpacing: "-.03em", fontWeight: 800, color: "var(--color-text-primary)", marginBottom: 20 }}>
          Understand what a code change<br />
          <em style={{ color: "var(--color-accent)", fontStyle: "normal" }}>can break before it does.</em>
        </h1>
        <p style={{ maxWidth: 560, lineHeight: 1.75, color: "var(--color-text-secondary)", fontSize: 16, marginBottom: 36 }}>
          Understand what a code change can break, discover why it matters, propose a safe fix,
          and verify the result with real evidence.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary btn-lg"
            onClick={() => onNavigate("repository")}
            aria-label="Start an analysis"
          >
            Start Analysis
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button
            className="btn btn-secondary btn-lg"
            onClick={onDemoMode}
            aria-label="Load demonstration data"
          >
            View Demo
          </button>
        </div>
      </section>

      {/* Workflow steps */}
      <section style={{ borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)", padding: "32px 0", marginBottom: 60 }}>
        <p className="eyebrow" style={{ marginBottom: 20 }}>THE WORKFLOW</p>
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {WORKFLOW_STEPS.map((step, i) => (
            <div key={step.label} style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0 }}>
              <div style={{ textAlign: "center", flex: 1, padding: "0 12px" }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", color: "var(--color-accent)", background: "var(--color-bg-card)" }}>
                  {step.icon}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 4 }}>{step.label}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "'DM Mono', monospace" }}>{step.desc}</div>
              </div>
              {i < WORKFLOW_STEPS.length - 1 && (
                <div style={{ width: 24, flexShrink: 0, height: 1, background: "var(--color-border)", position: "relative" }}>
                  <span style={{ position: "absolute", right: 0, top: -3, width: 7, height: 7, borderTop: "1px solid var(--color-text-secondary)", borderRight: "1px solid var(--color-text-secondary)", transform: "rotate(45deg)", display: "block" }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ marginBottom: 60 }}>
        <p className="eyebrow" style={{ marginBottom: 20 }}>WHAT IT DOES</p>
        <div className="grid-three" style={{ gap: 16 }}>
          {[
            { title: "Dependency Graph", desc: "Builds an interactive graph of file and module dependencies from actual Python AST analysis — not guesswork.", color: "var(--color-severity-low)" },
            { title: "Risk Findings", desc: "Identifies security risks, API surface changes, database impact, and test coverage gaps from static analysis.", color: "var(--color-severity-high)" },
            { title: "AI Fix Planning", desc: "When NEBIUS_API_KEY is configured, uses NVIDIA LLaMA via Nebius AI Studio to reason about the safest repair order.", color: "var(--color-severity-info)" },
            { title: "Patch Generation", desc: "Generates unified diffs that require explicit approval before any file is modified.", color: "var(--color-accent)" },
            { title: "Test Verification", desc: "Discovers and runs the repository's own test suite; attaches captured output as evidence.", color: "var(--color-severity-medium)" },
            { title: "Activity Log", desc: "Every analysis, verification, and implementation action is recorded locally for audit and review.", color: "var(--color-text-secondary)" },
          ].map(f => (
            <div key={f.title} className="card" style={{ borderLeft: `3px solid ${f.color}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: "var(--color-text-secondary)", lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Tech stack */}
      <section style={{ borderTop: "1px solid var(--color-border)", paddingTop: 32, marginBottom: 40 }}>
        <p className="eyebrow" style={{ marginBottom: 20 }}>TECHNOLOGY STACK</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {TECH_STACK.map(t => (
            <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--color-bg-card)", border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", padding: "10px 14px", minWidth: 180 }}>
              <span style={{ color: "var(--color-accent)" }}>{t.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>{t.name}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-secondary)", fontFamily: "'DM Mono', monospace" }}>{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 16, fontSize: 12, color: "var(--color-text-secondary)" }}>
          AI features require NEBIUS_API_KEY to be configured on the backend. All static analysis features work without any external credentials.
        </p>
      </section>
    </div>
  );
}
