// CI check for the contract-first rule: hot and normal files must not share a PR (ARCH 14.3).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classify, loadHotFiles } from "./lib/hot-files.mjs";
import { runForOutput } from "./lib/proc.mjs";

/** The PR template (task 24) must contain exactly this line. */
export const ACK_TEXT = "Zmiana plików wspólnych uzgodniona z zespołem";

const ACK_PATTERN = new RegExp(
  `^[ \\t]*[-*][ \\t]+\\[[xX]\\][ \\t]+${ACK_TEXT}[ \\t]*$`,
  "mu",
);

/** Comments and fenced blocks are not something the author ticked. */
const stripInert = (/** @type {string} */ body) =>
  body
    .replaceAll("\r\n", "\n")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gmu, "");

/** @param {string} body */
export const isAcknowledged = (body) => ACK_PATTERN.test(stripInert(body));

/**
 * Renames become delete + add, so moving a hot file out of a hot folder still counts as touching it.
 * @param {string} base @param {string} head
 */
export const diffArgs = (base, head) => [
  "-c",
  "core.quotepath=off",
  "diff",
  "--name-only",
  "--no-renames",
  `${base}...${head}`,
];

/**
 * @param {{ files: string[], body: string, patterns: string[] }} input
 * @returns {{ ok: boolean, message: string, hot: string[], normal: string[] }}
 */
export function evaluate({ files, body, patterns }) {
  const hot = [];
  const normal = [];
  for (const file of files) {
    const level = classify(file, patterns);
    if (level === "hot") hot.push(file);
    else if (level === "normal") normal.push(file);
  }
  if (hot.length === 0 || normal.length === 0)
    return { ok: true, message: "No hot/normal mix.", hot, normal };
  if (isAcknowledged(body))
    return {
      ok: true,
      message: "Mixed PR, acknowledged in the PR body.",
      hot,
      normal,
    };
  return {
    ok: false,
    message: [
      "This PR mixes hot files with feature files (contract-first rule).",
      "Split it into a contract PR and a feature PR, or tick the box",
      `"- [x] ${ACK_TEXT}" in the PR description and press "Re-run failed jobs".`,
      `Hot: ${hot.join(", ")}`,
      `Normal: ${normal.join(", ")}`,
    ].join("\n"),
    hot,
    normal,
  };
}

/** @param {NodeJS.ProcessEnv} env */
export function main(env) {
  const { PR_NUMBER, BASE_SHA, HEAD_SHA } = env;
  if (!PR_NUMBER || !BASE_SHA || !HEAD_SHA) {
    console.error("PR_NUMBER, BASE_SHA and HEAD_SHA are required.");
    return 2;
  }
  const patterns = loadHotFiles(
    fileURLToPath(new URL("../.github/hot-files.txt", import.meta.url)),
  );
  const files = runForOutput("git", diffArgs(BASE_SHA, HEAD_SHA))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const body = JSON.parse(
    runForOutput("gh", ["pr", "view", PR_NUMBER, "--json", "body"]),
  ).body;
  const result = evaluate({ files, body: body ?? "", patterns });
  (result.ok ? console.log : console.error)(result.message);
  return result.ok ? 0 : 1;
}

const entry = process.argv[1];
if (
  entry &&
  realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    process.exitCode = main(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
