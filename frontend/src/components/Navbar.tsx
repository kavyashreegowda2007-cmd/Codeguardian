import React from "react";
import { ShieldCheck, LayoutDashboard, FolderOpen, GitBranch, AlertTriangle, Wrench, FileDiff, CheckCircle, Activity, Home } from "lucide-react";
import type { ViewName } from "../App";

interface NavItem {
  view: ViewName;
  label: string;
  icon: React.ReactNode;
}

interface NavbarProps {
  currentView: ViewName;
  onNavigate: (view: ViewName) => void;
  hasAnalysis: boolean;
  backendOnline: boolean | null;
}

const NAV_ITEMS: NavItem[] = [
  { view: "landing",      label: "Home",         icon: <Home size={14} /> },
  { view: "dashboard",    label: "Dashboard",    icon: <LayoutDashboard size={14} /> },
  { view: "repository",   label: "Repository",   icon: <FolderOpen size={14} /> },
  { view: "impact",       label: "Impact",       icon: <GitBranch size={14} /> },
  { view: "findings",     label: "Findings",     icon: <AlertTriangle size={14} /> },
  { view: "planning",     label: "Planning",     icon: <Wrench size={14} /> },
  { view: "patch",        label: "Patches",      icon: <FileDiff size={14} /> },
  { view: "verification", label: "Verification", icon: <CheckCircle size={14} /> },
  { view: "activity",     label: "Activity",     icon: <Activity size={14} /> },
];

export function Navbar({ currentView, onNavigate, hasAnalysis, backendOnline }: NavbarProps) {
  return (
    <nav
      aria-label="Main navigation"
      style={{
        background: "var(--color-bg-primary)",
        borderBottom: "1px solid var(--color-border)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 clamp(16px, 4vw, 48px)", display: "flex", alignItems: "center", gap: 0, height: 60, overflowX: "auto" }}>
        {/* Brand */}
        <button
          onClick={() => onNavigate("landing")}
          aria-label="CodeGuardian home"
          style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "0 20px 0 0", borderRight: "1px solid var(--color-border)", marginRight: 16, flexShrink: 0 }}
        >
          <span style={{ width: 28, height: 28, background: "var(--color-accent)", display: "grid", placeItems: "center", borderRadius: 4, color: "#0a0f1e" }}>
            <ShieldCheck size={16} />
          </span>
          <strong style={{ fontSize: 13, letterSpacing: ".1em", color: "var(--color-text-primary)", fontFamily: "'DM Mono', monospace" }}>CODEGUARDIAN</strong>
        </button>

        {/* Nav links */}
        <div role="menubar" style={{ display: "flex", gap: 4, flex: 1, alignItems: "center", overflow: "hidden" }}>
          {NAV_ITEMS.map(({ view, label, icon }) => {
            const isActive = currentView === view;
            const requiresAnalysis = !["landing", "dashboard", "repository"].includes(view);
            const disabled = requiresAnalysis && !hasAnalysis;
            return (
              <button
                key={view}
                role="menuitem"
                onClick={() => !disabled && onNavigate(view)}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !disabled) onNavigate(view); }}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={disabled}
                tabIndex={disabled ? -1 : 0}
                title={disabled ? "Run an analysis first" : label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  background: "none",
                  border: "none",
                  borderRadius: 4,
                  cursor: disabled ? "not-allowed" : "pointer",
                  color: isActive ? "var(--color-accent)" : disabled ? "var(--color-border)" : "var(--color-text-secondary)",
                  font: "600 11px 'DM Mono', monospace",
                  letterSpacing: ".04em",
                  whiteSpace: "nowrap",
                  textTransform: "uppercase",
                  borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
                  transition: "color 0.15s",
                }}
              >
                {icon}
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Backend status indicator */}
        <div
          aria-live="polite"
          aria-label={backendOnline === null ? "Checking backend" : backendOnline ? "Backend online" : "Backend offline"}
          style={{ display: "flex", alignItems: "center", gap: 6, font: "10px 'DM Mono', monospace", color: backendOnline ? "var(--color-accent)" : backendOnline === false ? "var(--color-severity-critical)" : "var(--color-text-secondary)", flexShrink: 0, marginLeft: 16 }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: backendOnline ? "var(--color-accent)" : backendOnline === false ? "var(--color-severity-critical)" : "var(--color-text-secondary)", display: "inline-block" }} />
          {backendOnline === null ? "CHECKING" : backendOnline ? "ONLINE" : "OFFLINE"}
        </div>
      </div>
    </nav>
  );
}
