import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./approval.css";
import "./report.css";
import "./verification.css";

const container = document.getElementById("root")!;
const rootHost = globalThis as typeof globalThis & { __codeguardianRoot?: ReturnType<typeof createRoot> };
const root = rootHost.__codeguardianRoot ?? createRoot(container);
rootHost.__codeguardianRoot = root;
root.render(<StrictMode><App /></StrictMode>);
