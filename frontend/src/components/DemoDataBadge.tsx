import React from "react";
import { FlaskConical } from "lucide-react";

export function DemoDataBadge() {
  return (
    <span className="demo-badge" aria-label="Demonstration data — not from a real repository">
      <FlaskConical size={11} aria-hidden="true" />
      DEMO DATA
    </span>
  );
}
