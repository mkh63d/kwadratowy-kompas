import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["default", ["json", { outputFile: "reports/vitest.json" }]],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text-summary", "lcov", "json-summary"],
    },
    projects: [
      {
        plugins: [react()],
        test: {
          name: "frontend",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["src/test/setup.ts"],
        },
      },
      {
        test: {
          name: "backend",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/**/*.test.ts"],
        },
      },
    ],
  },
});
