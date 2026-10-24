import type { Result, Verification, Finding } from "./types";

export const DEMO_RESULT: Result = {
  request: "Add phone-number authentication",
  impact_message: "Authentication changes affect login flow, session management, and API security",
  analysis_duration: 2.4,
  affected_files: ["auth/login.py", "auth/models.py", "api/routes/auth.py", "tests/test_auth.py", "config/settings.py"],
  affected_components: ["LoginHandler", "UserModel", "SessionManager", "PhoneVerifier"],
  affected_apis: ["/api/auth/login", "/api/auth/verify", "/api/auth/logout"],
  database_components: ["users", "sessions", "phone_verifications"],
  dependencies: ["twilio", "phonenumbers", "bcrypt", "pyjwt"],
  tests: ["tests/test_auth.py", "tests/test_session.py"],
  security_risks: ["Phone number enumeration via timing attack", "SMS token brute-force without rate limiting"],
  confidence: 78,
  confidence_label: "medium",
  plan: [
    { task: "Add PhoneVerification model", files: ["auth/models.py"], reason: "Store OTP and verification state", risk: "low" },
    { task: "Implement SMS dispatch service", files: ["auth/sms_service.py"], reason: "Integrate Twilio SMS API", risk: "medium" },
    { task: "Add phone auth API route", files: ["api/routes/auth.py"], reason: "Expose /api/auth/phone endpoint", risk: "high" },
    { task: "Update login handler", files: ["auth/login.py"], reason: "Support phone as alternate identifier", risk: "medium" },
    { task: "Write regression tests", files: ["tests/test_auth.py"], reason: "Verify OTP flow and edge cases", risk: "low" },
  ],
  evidence: {
    files: ["auth/login.py", "auth/models.py", "api/routes/auth.py", "tests/test_auth.py", "config/settings.py"],
    symbols: [
      { name: "LoginHandler", kind: "class", file: "auth/login.py", line: 12 },
      { name: "UserModel", kind: "class", file: "auth/models.py", line: 5 },
      { name: "auth_router", kind: "variable", file: "api/routes/auth.py", line: 1 },
    ],
  },
};

export const DEMO_VERIFICATION: Verification = {
  status: "TESTS_PASSED",
  reason: "All 24 tests passed successfully",
  framework: "pytest",
  passed: 24,
  failed: 0,
  skipped: 2,
  errors: 0,
  total: 26,
  duration: 3.71,
  tests_discovered: 26,
  command: [["pytest", "tests/", "-v"]],
  working_directory: "/repo",
  stdout: "========================= 24 passed, 2 skipped in 3.71s =========================",
  stderr: "",
  return_code: 0,
};

export const DEMO_FINDINGS: Finding[] = [
  {
    id: "DEMO-001",
    severity: "high",
    category: "security",
    title: "SMS OTP brute-force not rate-limited",
    description: "The phone verification endpoint does not enforce a rate limit on OTP attempts, allowing an attacker to enumerate valid tokens.",
    file: "api/routes/auth.py",
    line: 47,
    confidence: 0.88,
    source: "deterministic",
    evidence: "No rate-limit middleware found on /api/auth/verify route",
  },
  {
    id: "DEMO-002",
    severity: "medium",
    category: "security",
    title: "Phone number enumeration via timing",
    description: "User existence is revealed by the difference in response time when a phone number is registered vs unregistered.",
    file: "auth/login.py",
    line: 83,
    confidence: 0.72,
    source: "ai",
    evidence: "Database lookup executed only for known users, leaking timing information",
  },
  {
    id: "DEMO-003",
    severity: "low",
    category: "quality",
    title: "Missing input validation for phone numbers",
    description: "Phone numbers are stored without E.164 normalization, causing inconsistent lookups.",
    file: "auth/models.py",
    line: 31,
    confidence: 0.9,
    source: "deterministic",
    evidence: "No phonenumbers.parse() call found in model validation",
  },
];

export const DEMO_GRAPH_NODES = [
  { id: "auth/login.py", label: "login.py", type: "source" },
  { id: "auth/models.py", label: "models.py", type: "source" },
  { id: "api/routes/auth.py", label: "auth.py", type: "source" },
  { id: "tests/test_auth.py", label: "test_auth.py", type: "test" },
  { id: "config/settings.py", label: "settings.py", type: "config" },
];

export const DEMO_GRAPH_EDGES = [
  { source: "auth/login.py", target: "auth/models.py", type: "imports" },
  { source: "api/routes/auth.py", target: "auth/login.py", type: "imports" },
  { source: "api/routes/auth.py", target: "auth/models.py", type: "imports" },
  { source: "tests/test_auth.py", target: "auth/login.py", type: "imports" },
  { source: "auth/login.py", target: "config/settings.py", type: "imports" },
];
