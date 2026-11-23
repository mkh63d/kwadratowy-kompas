// Shows who else touches the files I am changing: open PRs and other local worktrees (ARCH 14.2).
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorktrees } from "./lane.mjs";
import { classify, loadHotFiles, matchesGlobPath } from "./lib/hot-files.mjs";
import { runForOutput } from "./lib/proc.mjs";

const BASE = "origin/main";
const HOT_FILES = fileURLToPath(
  new URL("../.github/hot-files.txt", import.meta.url),
);
const USAGE = `Usage: npm run overlap -- [--paths <glob>...] [--strict]`;

/**
 * @typedef {{ paths: string[] | null, strict: boolean }} ParsedArgs
 * @param {string[]} argv arguments after `node scripts/overlap.mjs`
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {string[] | null} */
  let paths = null;
  let strict = false;
  let collecting = false;
  for (const arg of argv) {
    if (arg === "--strict") {
      strict = true;
      collecting = false;
    } else if (arg === "--paths") {
      paths = paths ?? [];
      collecting = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}\n${USAGE}`);
    } else if (collecting && paths) {
      paths.push(arg);
    } else {
      throw new Error(`Unexpected argument "${arg}".\n${USAGE}`);
    }
  }
  if (paths?.length === 0)
    throw new Error(`--paths needs at least one glob.\n${USAGE}`);
  return { paths, strict };
}

/** @param {string} text newline-separated paths @returns {string[]} */
export function splitLines(text) {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * @typedef {{ number: number, title: string, author: { login: string } | null,
 *   headRefName: string, files: { path: string }[] }} PullRequest
 * @param {string} json output of `gh pr list --json ...`
 * @returns {PullRequest[]}
 */
export function parsePullRequests(json) {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("unexpected gh output");
  return parsed;
}

/**
 * @typedef {{ file: string, level: "hot" | "exempt" | "normal", others: string[] }} Overlap
 */

/**
 * @param {{
 *   mine: string[] | { globs: string[] },
 *   others: { label: string, files: string[] }[],
 *   patterns: string[],
 * }} input `mine` is a list of changed files, or the globs given with --paths
 * @returns {Overlap[]} files touched by me and by at least one other party, sorted by path
 */
export function findOverlaps({ mine, others, patterns }) {
  const isMine = Array.isArray(mine)
    ? (/** @type {string} */ file) => mine.includes(file)
    : (/** @type {string} */ file) =>
        mine.globs.some((glob) => matchesGlobPath(file, glob));

  /** @type {Map<string, Set<string>>} */
  const byFile = new Map();
  for (const other of others) {
    for (const file of other.files) {
      if (!isMine(file)) continue;
      byFile.set(file, (byFile.get(file) ?? new Set()).add(other.label));
    }
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, labels]) => ({
      file,
      level: classify(file, patterns),
      others: [...labels],
    }));
}

/** @param {Overlap[]} overlaps */
export function formatOverlaps(overlaps) {
  if (overlaps.length === 0) return "No overlaps.";
  return overlaps
    .map(({ file, level, others }) => {
      const mark =
        level === "hot" ? "  [HOT]" : level === "exempt" ? "  (generated)" : "";
      return [`${file}${mark}`, ...others.map((o) => `  - ${o}`)].join("\n");
    })
    .join("\n");
}

/** @param {PullRequest} pr */
const prLabel = (pr) =>
  `PR #${pr.number} "${pr.title}" (@${pr.author?.login ?? "unknown"}, ${pr.headRefName})`;

/**
 * @typedef {{
 *   cwd: string,
 *   output: (command: string, args: string[], cwd: string) => string,
 *   patterns: string[],
 *   log: (message: string) => void,
 *   warn: (message: string) => void,
 * }} Deps
 */

/**
 * Branch commits since the merge base, plus working-tree changes and untracked files.
 * @param {Deps} deps @param {string} dir
 * @returns {string[]}
 */
function changedFiles(deps, dir) {
  const git = (/** @type {string[]} */ ...args) =>
    splitLines(deps.output("git", ["-c", "core.quotepath=off", ...args], dir));
  return [
    ...new Set([
      ...git("diff", "--name-only", `${BASE}...HEAD`),
      ...git("diff", "--name-only", "HEAD"),
      ...git("ls-files", "--others", "--exclude-standard"),
    ]),
  ];
}

/** @param {string} a @param {string} b */
function sameDir(a, b) {
  const [x, y] = [resolve(a), resolve(b)];
  return process.platform === "win32"
    ? x.toLowerCase() === y.toLowerCase()
    : x === y;
}

/**
 * @param {Deps} deps
 * @param {ParsedArgs} args
 * @returns {{ exitCode: number, overlaps: Overlap[] }}
 */
export function runOverlap(deps, args) {
  const root = splitLines(
    deps.output("git", ["rev-parse", "--show-toplevel"], deps.cwd),
  )[0];
  if (!root) throw new Error("Not inside a git repository.");
  const branch = splitLines(
    deps.output("git", ["branch", "--show-current"], root),
  )[0];

  /** @type {string[] | { globs: string[] }} */
  let mine;
  if (args.paths) {
    mine = { globs: args.paths };
  } else {
    try {
      mine = changedFiles(deps, root);
    } catch {
      throw new Error(
        `Could not diff against ${BASE}. Run \`git fetch origin main\` or pass --paths <glob>.`,
      );
    }
    if (mine.length === 0)
      deps.log(`No changes against ${BASE}; nothing to compare.`);
  }

  /** @type {{ label: string, files: string[] }[]} */
  const others = [];

  try {
    const prs = parsePullRequests(
      deps.output(
        "gh",
        [
          "pr",
          "list",
          "--state",
          "open",
          "--limit",
          "100",
          "--json",
          "number,title,author,headRefName,files",
        ],
        root,
      ),
    );
    for (const pr of prs) {
      if (branch && pr.headRefName === branch) continue;
      others.push({ label: prLabel(pr), files: pr.files.map((f) => f.path) });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : "";
    deps.warn(
      `Skipping open PRs (gh missing, offline or not logged in${reason ? `: ${reason}` : ""}).`,
    );
  }

  const worktrees = parseWorktrees(
    deps.output("git", ["worktree", "list", "--porcelain"], root),
  );
  for (const tree of worktrees) {
    if (sameDir(tree.path, root)) continue;
    const name = tree.branch ?? "detached HEAD";
    try {
      others.push({
        label: `lane ${name} (${tree.path})`,
        files: changedFiles(deps, tree.path),
      });
    } catch {
      deps.warn(`Skipping worktree ${tree.path}: could not read its diff.`);
    }
  }

  const overlaps = findOverlaps({ mine, others, patterns: deps.patterns });
  deps.log(formatOverlaps(overlaps));
  const hot = overlaps.some((o) => o.level === "hot");
  if (hot) deps.warn("Hot-file overlap: stop and ask a human before editing.");
  return { exitCode: args.strict && hot ? 1 : 0, overlaps };
}

/** @returns {Deps} */
function realDeps() {
  return {
    cwd: process.cwd(),
    patterns: loadHotFiles(HOT_FILES),
    output: runForOutput,
    log: (message) => console.log(message),
    warn: (message) => console.warn(`warning: ${message}`),
  };
}

/** @param {string[]} argv */
export function main(argv) {
  try {
    process.exitCode = runOverlap(realDeps(), parseArgs(argv)).exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

const entry = process.argv[1];
if (
  entry &&
  realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
)
  main(process.argv.slice(2));
