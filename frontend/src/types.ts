export type PlanItem = {
  task: string;
  files: string[];
  reason: string;
  risk: string;
};

export type Result = {
  request: string;
  impact_message: string;
  analysis_duration: number;
  affected_files: string[];
  affected_components: string[];
  affected_apis: string[];
  database_components: string[];
  dependencies: string[];
  tests: string[];
  security_risks: string[];
  confidence: number;
  confidence_label: string;
  plan: PlanItem[];
  evidence: {
    files: string[];
    symbols: { name: string; kind: string; file: string; line: number }[];
    imports: Record<string, string[]>;
    dependencies: string[];
    tests: string[];
    routes: string[];
    database_components: string[];
    configuration: string[];
  };
};

export type Verification = {
  status: string;
  reason?: string | null;
  framework: string | null;
  passed: number | null;
  failed: number | null;
  skipped: number | null;
  errors: number | null;
  total: number | null;
  duration: number | null;
  tests_discovered: number;
  command: string[][];
  working_directory: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  return_code?: number | null;
};

export type ImplementationResult = {
  status: string;
  message: string;
  pre_commit_sha?: string | null;
  diff?: string | null;
  verification?: Verification | null;
  rolled_back?: boolean;
  files_changed?: string[];
  allowed_files?: string[];
  limitation?: string | null;
  patch_data?: { file: string; unified_diff: string }[];
};

export type StoredAnalysis = {
  id: string;
  repository_path: string;
  result: Result;
  verification?: Verification;
  ai_analysis?: AiAnalysis;
  status: string;
  created_at?: string;
};

export type Finding = {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  file?: string;
  line?: number;
  confidence: number;
  source: string;
  evidence?: string;
};

export type FindingsSummary = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  file?: string;
};

export type GraphEdge = {
  source: string;
  target: string;
  type?: string;
};

export type ActivityEvent = {
  id: string;
  timestamp: string;
  type: "analysis" | "verification" | "implementation" | "ai_analysis";
  message: string;
  analysis_id?: string;
};

export type AiInvestigator = {
  findings_confirmed: unknown[];
  findings_added: unknown[];
  risk_narrative: string;
  priority_areas: string[];
  partial?: boolean;
};

export type AiRankedRisk = {
  file: string;
  risk_level: string;
  reason: string;
};

export type AiImpactAnalyst = {
  impact_summary: string;
  ranked_risks: AiRankedRisk[];
  blast_radius: number;
  uncertainty: string;
  partial?: boolean;
};

export type AiPlannerTask = {
  id: string;
  title: string;
  description: string;
  files: string[];
  priority: number;
  complexity_estimate: string;
  rationale: string;
};

export type AiPlanner = {
  tasks: AiPlannerTask[];
  partial?: boolean;
  error?: string;
};

export type AiReportGenerator = {
  executive_summary: string;
  key_findings: string[];
  recommended_actions: string[];
  confidence_level: string;
  limitations: string[];
  partial?: boolean;
};

export type AiStages = {
  investigator?: AiInvestigator;
  impact_analyst?: AiImpactAnalyst;
  planner?: AiPlanner;
  report_generator?: AiReportGenerator;
};

export type AiAnalysis = {
  job_id: string;
  status: string;
  stages?: AiStages;
  error?: string | null;
};
