import React, { useState, useEffect } from "react";
import { Activity, Trash2, Download } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import type { ActivityEvent } from "../types";

const ACTIVITY_KEY = "codeguardian.activity";

function loadEvents(): ActivityEvent[] {
  try {
    return JSON.parse(window.localStorage.getItem(ACTIVITY_KEY) ?? "[]") as ActivityEvent[];
  } catch {
    return [];
  }
}

const TYPE_COLORS: Record<string, string> = {
  analysis:       "var(--color-severity-low)",
  verification:   "var(--color-accent)",
  implementation: "var(--color-severity-info)",
  ai_analysis:    "var(--color-severity-medium)",
};

const TYPE_LABELS: Record<string, string> = {
  analysis:       "ANALYSIS",
  verification:   "VERIFICATION",
  implementation: "IMPLEMENTATION",
  ai_analysis:    "AI ANALYSIS",
};

export function ActivityView() {
  const [events, setEvents] = useState<ActivityEvent[]>(loadEvents);

  // Sync from localStorage on mount
  useEffect(() => {
    setEvents(loadEvents());
  }, []);

  function clearLog() {
    window.localStorage.setItem(ACTIVITY_KEY, "[]");
    setEvents([]);
  }

  function exportLog() {
    const json = JSON.stringify(events, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `codeguardian-activity-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-container">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="eyebrow">ACTIVITY LOG</p>
          <h1>Event History</h1>
          <p>{events.length} events recorded locally.</p>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={exportLog}
            disabled={events.length === 0}
            aria-disabled={events.length === 0}
            aria-label="Export activity log as JSON"
          >
            <Download size={14} />
            Export JSON
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={clearLog}
            disabled={events.length === 0}
            aria-disabled={events.length === 0}
            aria-label="Clear activity log"
          >
            <Trash2 size={14} />
            Clear Log
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description="Events are recorded automatically when you run analyses, verifications, and implementations."
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[...events].reverse().map((event) => (
            <div
              key={event.id}
              style={{ display: "flex", gap: 16, padding: "16px 0", borderBottom: "1px solid var(--color-border)", alignItems: "flex-start" }}
            >
              <div
                style={{ width: 10, height: 10, borderRadius: "50%", background: TYPE_COLORS[event.type] ?? "var(--color-text-secondary)", flexShrink: 0, marginTop: 4 }}
                aria-hidden="true"
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                  <span
                    className="badge badge-outline"
                    style={{ borderColor: TYPE_COLORS[event.type] ?? "var(--color-border)", color: TYPE_COLORS[event.type] ?? "var(--color-text-secondary)", fontSize: 9 }}
                  >
                    {TYPE_LABELS[event.type] ?? event.type}
                  </span>
                  <time
                    dateTime={event.timestamp}
                    style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "var(--color-text-secondary)" }}
                  >
                    {new Date(event.timestamp).toLocaleString()}
                  </time>
                  {event.analysis_id && (
                    <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "var(--color-text-secondary)" }}>
                      ID: {event.analysis_id.slice(0, 8)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-primary)" }}>{event.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
