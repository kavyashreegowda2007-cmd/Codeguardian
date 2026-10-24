import React, { useEffect, useState, useCallback } from "react";
import { Navbar } from "./components/Navbar";
import { LandingView } from "./views/LandingView";
import { DashboardView } from "./views/DashboardView";
import { RepositoryView } from "./views/RepositoryView";
import { ImpactView } from "./views/ImpactView";
import { FindingsView } from "./views/FindingsView";
import { PlanningView } from "./views/PlanningView";
import { PatchView } from "./views/PatchView";
import { VerificationView } from "./views/VerificationView";
import { ActivityView } from "./views/ActivityView";
import { DEMO_RESULT, DEMO_VERIFICATION } from "./demoData";
import type { Result, Verification, ImplementationResult, StoredAnalysis, ActivityEvent } from "./types";
import { api } from "./api";

const ACTIVITY_KEY = "codeguardian.activity";

export type ViewName =
  | "landing"
  | "dashboard"
  | "repository"
  | "impact"
  | "findings"
  | "planning"
  | "patch"
  | "verification"
  | "activity";

function logActivity(type: ActivityEvent["type"], message: string, analysisId?: string): void {
  try {
    const events: ActivityEvent[] = JSON.parse(window.localStorage.getItem(ACTIVITY_KEY) ?? "[]") as ActivityEvent[];
    const event: ActivityEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      type,
      message,
      analysis_id: analysisId,
    };
    events.push(event);
    // Keep last 200 events
    if (events.length > 200) events.splice(0, events.length - 200);
    window.localStorage.setItem(ACTIVITY_KEY, JSON.stringify(events));
  } catch { /* storage errors are non-fatal */ }
}

export default function App() {
  const [view, setView] = useState<ViewName>("landing");
  const [request, setRequest] = useState("Add phone-number authentication");
  const [repositoryPath, setRepositoryPath] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [analysisId, setAnalysisId] = useState("");
  const [verification, setVerification] = useState<Verification | null>(null);
  const [implementation, setImplementation] = useState<ImplementationResult | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  // Check backend health
  useEffect(() => {
    api.health()
      .then(() => setBackendOnline(true))
      .catch(() => setBackendOnline(false));
  }, []);

  // Restore last analysis from localStorage
  useEffect(() => {
    const savedId = window.localStorage.getItem("codeguardian.analysisId");
    if (!savedId) return;
    api.getAnalysis(savedId)
      .then((data: StoredAnalysis) => {
        setAnalysisId(data.id);
        setRepositoryPath(data.repository_path);
        setRequest(data.result.request);
        setResult(data.result);
        setVerification(data.verification ?? null);
      })
      .catch(() => { /* silently skip if backend is down or returns non-JSON */ });
  }, []);

  const navigate = useCallback((to: ViewName) => {
    setView(to);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  function activateDemoMode() {
    setIsDemoMode(true);
    setResult(DEMO_RESULT);
    setVerification(DEMO_VERIFICATION);
    setAnalysisId("demo");
    setRepositoryPath("/demo/repository");
    setRequest(DEMO_RESULT.request);
    navigate("dashboard");
  }

  function handleAnalysisComplete(id: string, path: string, res: Result) {
    setAnalysisId(id);
    setRepositoryPath(path);
    setResult(res);
    setVerification(null);
    setImplementation(null);
    setIsDemoMode(false);
    logActivity("analysis", `Analysis complete: ${res.request} — ${res.affected_files.length} files affected`, id);
  }

  function handleSetVerification(v: Verification) {
    setVerification(v);
    logActivity("verification", `Verification ${v.status.replace(/_/g, " ")}: ${v.passed ?? 0} passed, ${v.failed ?? 0} failed`, analysisId || undefined);
  }

  function handleActivityLog(type: ActivityEvent["type"], message: string, id?: string) {
    logActivity(type, message, id);
  }

  const hasAnalysis = !!result;

  return (
    <div className="app-shell">
      <Navbar
        currentView={view}
        onNavigate={navigate}
        hasAnalysis={hasAnalysis}
        backendOnline={backendOnline}
      />
      <div className="app-content">
        {view === "landing" && (
          <LandingView onNavigate={navigate} onDemoMode={activateDemoMode} />
        )}
        {view === "dashboard" && (
          <DashboardView
            analysisId={analysisId}
            result={result}
            verification={verification}
            repositoryPath={repositoryPath}
            isDemoMode={isDemoMode}
            backendOnline={backendOnline}
            onNavigate={navigate}
          />
        )}
        {view === "repository" && (
          <RepositoryView
            request={request}
            setRequest={setRequest}
            repositoryPath={repositoryPath}
            setRepositoryPath={setRepositoryPath}
            result={result}
            analysisId={analysisId}
            onAnalysisComplete={handleAnalysisComplete}
            onNavigate={navigate}
          />
        )}
        {view === "impact" && (
          <ImpactView
            analysisId={analysisId}
            result={result}
            isDemoMode={isDemoMode}
          />
        )}
        {view === "findings" && (
          <FindingsView
            analysisId={analysisId}
            isDemoMode={isDemoMode}
          />
        )}
        {view === "planning" && (
          <PlanningView
            analysisId={analysisId}
            result={result}
            isDemoMode={isDemoMode}
          />
        )}
        {view === "patch" && (
          <PatchView
            analysisId={analysisId}
            result={result}
            implementation={implementation}
            setImplementation={setImplementation}
            isDemoMode={isDemoMode}
          />
        )}
        {view === "verification" && (
          <VerificationView
            analysisId={analysisId}
            repositoryPath={repositoryPath}
            verification={verification}
            setVerification={handleSetVerification}
            isDemoMode={isDemoMode}
            onNavigate={navigate}
            onActivityLog={handleActivityLog}
          />
        )}
        {view === "activity" && (
          <ActivityView />
        )}
      </div>
    </div>
  );
}
