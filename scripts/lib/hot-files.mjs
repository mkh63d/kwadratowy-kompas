import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";

export const EXEMPT_GLOB = "convex/_generated/**";

/** @param {string} text contents of `.github/hot-files.txt` @returns {string[]} */
export function parseHotFiles(text) {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** @param {string} file @returns {string[]} */
export function loadHotFiles(file) {
  return parseHotFiles(readFileSync(file, "utf8"));
}

/** @param {string} path @param {string} glob */
const matches = (path, glob) => matchesGlob(path.replaceAll("\\", "/"), glob);

/**
 * `exempt` is regenerated output that rides along with any change: neither hot nor non-hot.
 * @param {string} path repo-relative
 * @param {string[]} patterns
 * @returns {"hot" | "exempt" | "normal"}
 */
export function classify(path, patterns) {
  if (matches(path, EXEMPT_GLOB)) return "exempt";
  return patterns.some((glob) => matches(path, glob)) ? "hot" : "normal";
}

/** @param {string} path @param {string[]} patterns */
export const isHot = (path, patterns) => classify(path, patterns) === "hot";

export { matches as matchesGlobPath };
