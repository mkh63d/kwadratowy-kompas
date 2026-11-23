import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** @param {string} dir @returns {Map<string, string>} */
function snapshot(dir) {
  /** @type {Map<string, string>} */
  const files = new Map();
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir).sort()) {
    files.set(
      name,
      readFileSync(join(dir, name), "utf8").replaceAll("\r\n", "\n"),
    );
  }
  return files;
}

/** @param {string} backup @param {string} dir */
function restore(backup, dir) {
  rmSync(dir, { recursive: true, force: true });
  cpSync(backup, dir, { recursive: true });
}

/**
 * Runs `runCodegen` and compares `dir` before and after (line endings ignored).
 * Whenever the result is not "fresh" the original files are put back, so the
 * check is idempotent: it fails again until the fix is committed.
 * @param {{ dir: string, runCodegen: () => number }} options runCodegen returns an exit code
 * @returns {{ status: "fresh" } | { status: "stale", changed: string[] } | { status: "failed" }}
 */
export function checkGenerated({ dir, runCodegen }) {
  const backup = mkdtempSync(join(tmpdir(), "codegen-check-"));
  try {
    const before = snapshot(dir);
    if (existsSync(dir)) cpSync(dir, backup, { recursive: true });

    if (runCodegen() !== 0) {
      restore(backup, dir);
      return { status: "failed" };
    }

    const after = snapshot(dir);
    const changed = [...new Set([...before.keys(), ...after.keys()])]
      .filter((name) => before.get(name) !== after.get(name))
      .sort();
    if (changed.length === 0) return { status: "fresh" };

    restore(backup, dir);
    return { status: "stale", changed };
  } finally {
    rmSync(backup, { recursive: true, force: true });
  }
}
