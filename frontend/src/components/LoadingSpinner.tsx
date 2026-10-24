import React from "react";
import { LoaderCircle } from "lucide-react";

interface LoadingSpinnerProps {
  size?: number;
  label?: string;
}

export function LoadingSpinner({ size = 24, label = "Loading…" }: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--color-text-secondary)", padding: "24px 0" }}
    >
      <LoaderCircle size={size} className="spin" />
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}
