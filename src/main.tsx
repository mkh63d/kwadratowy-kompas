import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { getEnv } from "./lib/env";
import { initSentry } from "./lib/sentry";

const { sentryDsn, commitSha } = getEnv();
initSentry({
  dsn: sentryDsn,
  environment: import.meta.env.MODE,
  release: commitSha,
}).catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
