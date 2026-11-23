// One-command lanes: a lane is a git worktree with its own ports and Convex deployment (ARCH 8.5).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_PORT, BASE_PREVIEW_PORT, readLocalEnv } from "./lib/lane-env.mjs";
import { CONVEX_BIN, runForOutput } from "./lib/proc.mjs";

export const MAX_LANES = 100;

const NAME_PART = /^[A-Za-z0-9-]+$/;
const USAGE = `Usage:
  npm run lane:new -- <member> <issue> <slug> [--local]
  npm run lane:list
  npm run lane:rm -- <slug> [--force]`;

/**
 * @typedef {{ command: "new", member: string, issue: string, slug: string, local: boolean }
 *   | { command: "list" }
 *   | { command: "rm", slug: string, force: boolean }} ParsedArgs
 */

/**
 * @param {string[]} argv arguments after `node scripts/lane.mjs`
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = rest.filter((a) => a.startsWith("--"));
  const positional = rest.filter((a) => !a.startsWith("--"));
  /** @param {string[]} allowed */
  const checkFlags = (allowed) => {
    const unknown = flags.filter((f) => !allowed.includes(f));
    if (unknown.length > 0)
      throw new Error(`Unknown option: ${unknown.join(", ")}\n${USAGE}`);
  };

  if (command === "new") {
    checkFlags(["--local"]);
    const [member, issue, slug, ...extra] = positional;
    if (!member || !issue || !slug || extra.length > 0)
      throw new Error(`lane:new needs <member> <issue> <slug>.\n${USAGE}`);
    return { command, member, issue, slug, local: flags.includes("--local") };
  }
  if (command === "list") {
    checkFlags([]);
    if (positional.length > 0)
      throw new Error(`lane:list takes no arguments.\n${USAGE}`);
    return { command };
  }
  if (command === "rm") {
    checkFlags(["--force"]);
    const [slug, ...extra] = positional;
    if (!slug || extra.length > 0)
      throw new Error(`lane:rm needs exactly one <slug>.\n${USAGE}`);
    return { command, slug, force: flags.includes("--force") };
  }
  throw new Error(`Unknown command "${command ?? ""}".\n${USAGE}`);
}

/**
 * Validates the parts of a lane and returns the Convex deployment reference.
 * Convex references are 3-100 characters of alphanumerics, dashes and slashes.
 * @param {{ member: string, issue: string, slug: string }} lane
 * @returns {string}
 */
export function deploymentReference({ member, issue, slug }) {
  for (const [label, value] of [
    ["member", member],
    ["issue", issue],
    ["slug", slug],
  ]) {
    if (!NAME_PART.test(String(value)))
      throw new Error(
        `Invalid ${label} "${value}": use only letters, digits and dashes.`,
      );
  }
  const reference = `dev/${member}/${issue}-${slug}`;
  if (reference.length < 3 || reference.length > 100)
    throw new Error(
      `Deployment reference "${reference}" must be 3-100 characters (got ${reference.length}).`,
    );
  return reference;
}

/**
 * First lane number (1, 2, ...) whose two ports are neither reserved by another
 * lane's env file nor in use on this machine. Lane 0 is the main checkout.
 * @param {{
 *   isPortFree: (port: number) => Promise<boolean>,
 *   reserved?: Iterable<number>,
 * }} options
 * @returns {Promise<{ lane: number, port: number, previewPort: number }>}
 */
export async function pickLane({ isPortFree, reserved = [] }) {
  const taken = new Set(reserved);
  for (let lane = 1; lane <= MAX_LANES; lane++) {
    const port = BASE_PORT + lane;
    const previewPort = BASE_PREVIEW_PORT + lane;
    if (taken.has(port) || taken.has(previewPort)) continue;
    if ((await isPortFree(port)) && (await isPortFree(previewPort)))
      return { lane, port, previewPort };
  }
  throw new Error(`No free lane among the first ${MAX_LANES} port pairs.`);
}

/**
 * Sets keys in dotenv text, replacing existing lines and keeping everything else.
 * @param {string} content
 * @param {Record<string, string | number>} values
 * @returns {string}
 */
export function upsertEnv(content, values) {
  const lines =
    content === "" ? [] : content.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const index = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (index === -1) lines.push(line);
    else lines[index] = line;
  }
  return `${lines.join("\n")}\n`;
}

/**
 * @typedef {{ path: string, branch: string | null }} Worktree
 * @param {string} porcelain output of `git worktree list --porcelain`
 * @returns {Worktree[]}
 */
export function parseWorktrees(porcelain) {
  return porcelain
    .replaceAll("\r\n", "\n")
    .split("\n\n")
    .filter((block) => block.trim() !== "")
    .map((block) => {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice(9) ?? "";
      const ref = lines.find((l) => l.startsWith("branch "))?.slice(7) ?? null;
      return { path, branch: ref?.replace(/^refs\/heads\//, "") ?? null };
    });
}

/**
 * @typedef {{
 *   slug: string, path: string, branch: string,
 *   port: string | null, previewPort: string | null, deployment: string | null,
 * }} Lane
 */

/**
 * Lanes are the worktrees on `feat/*` branches other than the main checkout (the first one).
 * @param {Worktree[]} worktrees
 * @param {(path: string) => Record<string, string>} readEnv
 * @returns {Lane[]}
 */
export function toLanes(worktrees, readEnv) {
  return worktrees.slice(1).flatMap(({ path, branch }) => {
    if (!branch?.startsWith("feat/")) return [];
    const env = readEnv(path);
    return [
      {
        slug: branch.slice("feat/".length),
        path,
        branch,
        port: env.PORT ?? null,
        previewPort: env.PREVIEW_PORT ?? null,
        deployment: env.CONVEX_DEPLOYMENT ?? null,
      },
    ];
  });
}

/** @param {Lane[]} lanes @returns {string} */
export function formatLanes(lanes) {
  if (lanes.length === 0) return "No lanes.";
  const rows = [
    ["SLUG", "PATH", "PORT", "PREVIEW", "CONVEX DEPLOYMENT"],
    ...lanes.map((l) => [
      l.slug,
      l.path,
      l.port ?? "-",
      l.previewPort ?? "-",
      l.deployment ?? "-",
    ]),
  ];
  const widths =
    rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i]?.length ?? 0))) ??
    [];
  return rows
    .map((r) =>
      r
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

/**
 * @param {string} slug as typed: `<issue>-<slug>`
 * @param {Lane[]} lanes
 * @returns {Lane}
 */
export function findLane(slug, lanes) {
  const lane = lanes.find((l) => l.slug === slug);
  if (!lane)
    throw new Error(
      `No lane "${slug}". Known lanes: ${lanes.map((l) => l.slug).join(", ") || "none"}.`,
    );
  return lane;
}

/**
 * The Convex CLI has no `deployment delete`: cloud deployments are removed in the dashboard
 * or expire, local ones live inside the worktree. CONVEX_DEPLOYMENT is `local:<name>` for local.
 * @param {Lane} lane
 */
export function deletionHint(lane) {
  if (lane.deployment?.startsWith("local:"))
    return `Its data lives in ${join(lane.path, ".convex", "local", "default")} and is removed with the worktree.`;
  return 'Delete it in the Convex dashboard (Project -> Deployments) or let it expire (created with --expiration "in 7 days").';
}

/**
 * @typedef {{
 *   cwd: string,
 *   run: (command: string, args: string[], options: { cwd: string, env?: Record<string, string> }) => number,
 *   output: (command: string, args: string[], cwd: string) => string,
 *   isPortFree: (port: number) => Promise<boolean>,
 *   readEnv: (dir: string) => Record<string, string>,
 *   writeEnv: (dir: string, values: Record<string, string | number>) => void,
 *   log: (message: string) => void,
 * }} Deps
 */

/** @param {Deps} deps @returns {Worktree[]} */
function listWorktrees(deps) {
  return parseWorktrees(
    deps.output("git", ["worktree", "list", "--porcelain"], deps.cwd),
  );
}

/**
 * @param {Deps} deps
 * @param {Extract<ParsedArgs, { command: "new" }>} args
 */
export async function laneNew(deps, args) {
  const reference = deploymentReference(args);
  const worktrees = listWorktrees(deps);
  const mainPath = worktrees[0]?.path ?? deps.cwd;
  const name = `${args.issue}-${args.slug}`;
  const branch = `feat/${name}`;
  const lanePath = resolve(mainPath, "..", `${basename(mainPath)}-${name}`);
  if (existsSync(lanePath)) throw new Error(`${lanePath} already exists.`);

  const reserved = toLanes(worktrees, deps.readEnv).flatMap((l) =>
    [l.port, l.previewPort].filter((p) => p !== null).map(Number),
  );
  const { lane, port, previewPort } = await pickLane({
    isPortFree: deps.isPortFree,
    reserved,
  });

  const step = (/** @type {string} */ message) => deps.log(`\n> ${message}`);
  /** @param {string} command @param {string[]} cmdArgs @param {string} cwd @param {Record<string, string>} [env] */
  const must = (command, cmdArgs, cwd, env) => {
    const status = deps.run(command, cmdArgs, { cwd, env });
    if (status !== 0)
      throw new Error(
        `\`${command} ${cmdArgs.join(" ")}\` failed (exit ${status}).`,
      );
  };

  step(`Creating worktree ${lanePath} on ${branch}`);
  must("git", ["worktree", "add", "-b", branch, lanePath], mainPath);

  step("Running npm ci (takes a minute or two)");
  must("npm", ["ci"], lanePath);

  step(
    args.local
      ? "Creating local Convex deployment"
      : `Creating Convex deployment ${reference} (expires in 7 days)`,
  );
  const create = args.local
    ? ["deployment", "create", "local", "--select"]
    : [
        "deployment",
        "create",
        reference,
        "--type",
        "dev",
        "--select",
        "--expiration",
        "in 7 days",
      ];
  must(
    process.execPath,
    [CONVEX_BIN, ...create],
    lanePath,
    args.local ? { CONVEX_AGENT_MODE: "anonymous" } : undefined,
  );

  deps.writeEnv(lanePath, { PORT: port, PREVIEW_PORT: previewPort });
  deps.log(
    `\nLane ${lane} ready: ${lanePath}\n  dev     http://localhost:${port}\n  preview http://localhost:${previewPort}\n  cd ${lanePath}`,
  );
  return { lanePath, branch, port, previewPort };
}

/** @param {Deps} deps */
export function laneList(deps) {
  const lanes = toLanes(listWorktrees(deps), deps.readEnv);
  deps.log(formatLanes(lanes));
  return lanes;
}

/**
 * @param {Deps} deps
 * @param {Extract<ParsedArgs, { command: "rm" }>} args
 */
export function laneRm(deps, args) {
  const lane = findLane(args.slug, toLanes(listWorktrees(deps), deps.readEnv));
  const removeArgs = [
    "worktree",
    "remove",
    ...(args.force ? ["--force"] : []),
    lane.path,
  ];
  const status = deps.run("git", removeArgs, { cwd: deps.cwd });
  if (status !== 0)
    throw new Error(
      `git could not remove ${lane.path} (uncommitted changes?). Re-run with --force to discard them.`,
    );
  deps.log(
    `Removed worktree ${lane.path}. Branch ${lane.branch} is kept (delete it with \`git branch -d ${lane.branch}\` once merged).\n` +
      `The Convex deployment is NOT deleted. ${deletionHint(lane)}`,
  );
  return lane;
}

/** @param {number} port @returns {Promise<boolean>} */
function probePort(port) {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, () => server.close(() => done(true)));
  });
}

/** @returns {Deps} */
function realDeps() {
  const win = process.platform === "win32";
  return {
    cwd: process.cwd(),
    run: (command, args, { cwd, env }) => {
      // Node refuses to spawn npm.cmd without a shell; npm_execpath (set under `npm run`) avoids one.
      const npmCli = process.env.npm_execpath;
      const viaNode = command === "npm" && npmCli;
      return (
        spawnSync(
          viaNode ? process.execPath : command,
          viaNode ? [npmCli, ...args] : args,
          {
            cwd,
            env: { ...process.env, ...env },
            stdio: "inherit",
            shell: win && command === "npm" && !npmCli,
          },
        ).status ?? 1
      );
    },
    output: runForOutput,
    isPortFree: probePort,
    readEnv: readLocalEnv,
    writeEnv: (dir, values) => {
      const file = join(dir, ".env.local");
      const current = existsSync(file) ? readFileSync(file, "utf8") : "";
      writeFileSync(file, upsertEnv(current, values));
    },
    log: (message) => console.log(message),
  };
}

/** @param {string[]} argv */
export async function main(argv) {
  try {
    const args = parseArgs(argv);
    const deps = realDeps();
    if (args.command === "new") await laneNew(deps, args);
    else if (args.command === "list") laneList(deps);
    else laneRm(deps, args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (
  entry &&
  realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
)
  await main(process.argv.slice(2));
