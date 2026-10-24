import type {
  StoredAnalysis,
  Result,
  Finding,
  FindingsSummary,
  GraphNode,
  GraphEdge,
  Verification,
  ImplementationResult,
  AiAnalysis,
} from "./types";

export const API_BASE = `${(import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "") || ""}/api`;

const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes
const AI_TIMEOUT_MS = 300_000;      // 5 minutes

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!text.trim()) throw new Error("Empty response from server");
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON from server");
    }
    if (!response.ok) {
      const detail = (data as { detail?: string })?.detail ?? `HTTP ${response.status}`;
      throw new Error(detail);
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health(): Promise<{ status: string }> {
    return request<{ status: string }>("/health");
  },

  analyze(repositoryPath: string, changeRequest: string): Promise<StoredAnalysis> {
    return request<StoredAnalysis>("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: changeRequest, repository_path: repositoryPath }),
    });
  },

  getAnalysis(analysisId: string): Promise<StoredAnalysis> {
    return request<StoredAnalysis>(`/analysis/${encodeURIComponent(analysisId)}`);
  },

  getFindings(analysisId: string): Promise<{ findings: Finding[]; summary: FindingsSummary }> {
    return request<{ findings: Finding[]; summary: FindingsSummary }>(
      `/analysis/${encodeURIComponent(analysisId)}/findings`,
    );
  },

  getGraph(analysisId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
    return request<{ nodes: GraphNode[]; edges: GraphEdge[] }>(
      `/analysis/${encodeURIComponent(analysisId)}/graph`,
    );
  },

  getPlan(analysisId: string): Promise<{ plan: Result["plan"] }> {
    return request<{ plan: Result["plan"] }>(
      `/analysis/${encodeURIComponent(analysisId)}/plan`,
    );
  },

  implement(payload: {
    analysis_id: string;
    approved: boolean;
    generate_patch?: boolean;
  }): Promise<ImplementationResult> {
    return request<ImplementationResult>("/implement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  verify(repositoryPath: string, analysisId?: string): Promise<Verification> {
    return request<Verification>("/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repository_path: repositoryPath, analysis_id: analysisId }),
    });
  },

  aiAnalyze(analysisId: string): Promise<{ job_id: string; status: string; analysis_id: string; error?: string }> {
    return request<{ job_id: string; status: string; analysis_id: string; error?: string }>(
      "/ai/analyze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis_id: analysisId }),
      },
      AI_TIMEOUT_MS,
    );
  },

  aiStatus(jobId: string): Promise<AiAnalysis> {
    return request<AiAnalysis>(`/ai/status/${encodeURIComponent(jobId)}`);
  },

  gitStatus(repositoryPath: string): Promise<{ clean: boolean; status: string[]; diff_stat: string[] }> {
    return request<{ clean: boolean; status: string[]; diff_stat: string[] }>(
      `/git/status?repository_path=${encodeURIComponent(repositoryPath)}`,
    );
  },

  report(analysisId: string, format: "json" | "markdown" = "json"): Promise<unknown> {
    return request<unknown>(
      `/analysis/${encodeURIComponent(analysisId)}/report?format=${format}`,
    );
  },
};
