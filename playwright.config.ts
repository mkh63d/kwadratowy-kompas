import { defineConfig, devices } from "@playwright/test";
import { resolvePorts } from "./scripts/lib/lane-env.mjs";

if (process.env.VITE_CONVEX_URL) {
  throw new Error(
    "VITE_CONVEX_URL is set in your shell; shell variables beat .env.e2e and would run the smoke test in online mode. Unset it and retry.",
  );
}

if (process.env.VITE_SENTRY_DSN) {
  throw new Error(
    "VITE_SENTRY_DSN is set in your shell; shell variables beat .env.e2e and would let the smoke test send events to Sentry. Unset it and retry.",
  );
}

const { previewPort: port } = resolvePorts(process.cwd());
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [
    ["list"],
    ["json", { outputFile: "reports/playwright.json" }],
    ...(isCI ? [] : ([["html", { open: "never" }]] as const)),
  ],
  use: { baseURL: `http://localhost:${port}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite build --mode e2e --outDir dist-e2e && npx vite preview --mode e2e --outDir dist-e2e --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
