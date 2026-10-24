import React from "react";
import { CircleAlert } from "lucide-react";

interface ErrorBannerProps {
  message: string;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert" aria-live="polite">
      <CircleAlert size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
