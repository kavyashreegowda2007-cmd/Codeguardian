import React from "react";

type Severity = "critical" | "high" | "medium" | "low" | "info";

interface SeverityBadgeProps {
  severity: string;
  count?: number;
}

export function SeverityBadge({ severity, count }: SeverityBadgeProps) {
  const s = severity.toLowerCase() as Severity;
  return (
    <span className={`badge badge-outline severity-${s}`}>
      {severity.toUpperCase()}
      {count !== undefined && <span style={{ marginLeft: 4 }}>{count}</span>}
    </span>
  );
}
