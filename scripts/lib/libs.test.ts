import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BASE_PORT,
  BASE_PREVIEW_PORT,
  readLocalEnv,
  resolvePorts,
} from "./lane-env.mjs";
import { CONVEX_BIN, runForOutput } from "./proc.mjs";

describe("runForOutput", () => {
  it("returns stdout", () => {
    expect(runForOutput(process.execPath, ["-p", "1+1"]).trim()).toBe("2");
  });

  it("names the command and stderr when it fails", () => {
    expect(() =>
      runForOutput(process.execPath, [
        "-e",
        "console.error('boom');process.exit(3)",
      ]),
    ).toThrow(/-e .*failed \(exit 3\): boom/s);
  });

  it("names the command when it cannot start", () => {
    expect(() => runForOutput("definitely-not-a-command-xyz", ["a"])).toThrow(
      /`definitely-not-a-command-xyz a` could not run/,
    );
  });

  it("points at the local Convex CLI", () => {
    expect(CONVEX_BIN.replaceAll("\\", "/")).toBe(
      "node_modules/convex/bin/main.js",
    );
  });
});

describe("lane-env", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lane-env-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to the default ports without .env.local", () => {
    expect(readLocalEnv(dir)).toEqual({});
    expect(resolvePorts(dir, {})).toEqual({
      port: BASE_PORT,
      previewPort: BASE_PREVIEW_PORT,
    });
  });

  it("reads ports from .env.local and lets the shell win", () => {
    writeFileSync(
      join(dir, ".env.local"),
      "PORT=5180\nPREVIEW_PORT=4180\nVITE_CONVEX_URL=https://x.convex.cloud\n",
    );
    expect(resolvePorts(dir, {})).toEqual({ port: 5180, previewPort: 4180 });
    expect(resolvePorts(dir, { PORT: "6000" })).toEqual({
      port: 6000,
      previewPort: 4180,
    });
  });

  it("never leaks VITE_CONVEX_URL into process.env", () => {
    writeFileSync(
      join(dir, ".env.local"),
      "VITE_CONVEX_URL=https://x.convex.cloud\n",
    );
    const before = process.env.VITE_CONVEX_URL;
    resolvePorts(dir);
    expect(process.env.VITE_CONVEX_URL).toBe(before);
    expect(process.env.VITE_CONVEX_URL).not.toBe("https://x.convex.cloud");
  });
});
