import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { resolvePorts } from "./scripts/lib/lane-env.mjs";

// Ports come from the worktree's .env.local (written by `npm run lane:new`); shell variables win.
const { port, previewPort } = resolvePorts(process.cwd());

// Source maps are built and uploaded only when the token is present; without it the build is unchanged.
// SENTRY_ORG and SENTRY_PROJECT are read from the environment by the plugin itself.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(uploadSourceMaps
      ? [
          sentryVitePlugin({
            telemetry: false,
            release: { name: process.env.VITE_COMMIT_SHA || undefined },
            sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
          }),
        ]
      : []),
  ],
  build: { sourcemap: uploadSourceMaps ? "hidden" : false },
  server: { port, strictPort: true },
  preview: { port: previewPort, strictPort: true },
});
