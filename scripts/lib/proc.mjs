import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Local Convex CLI, run through `process.execPath` so it works without a shell on Windows. */
export const CONVEX_BIN = join("node_modules", "convex", "bin", "main.js");

/**
 * Runs a command and returns its stdout; throws with the command line and stderr on failure.
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {string}
 */
export function runForOutput(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const line = `${command} ${args.join(" ")}`;
  if (result.error)
    throw new Error(`\`${line}\` could not run: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `\`${line}\` failed (exit ${result.status}): ${result.stderr.trim()}`,
    );
  return result.stdout;
}
