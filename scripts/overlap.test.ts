import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  findOverlaps,
  formatOverlaps,
  parseArgs,
  runOverlap,
} from "./overlap.mjs";
import { classify, loadHotFiles, parseHotFiles } from "./lib/hot-files.mjs";

const patterns = loadHotFiles(".github/hot-files.txt");

describe("hot-files", () => {
  it("ignores comments and blank lines", () => {
    expect(
      parseHotFiles("# c\n\nconvex/schema.ts\r\n  src/lib/**  \n"),
    ).toEqual(["convex/schema.ts", "src/lib/**"]);
  });

  it("loads the committed list including convex/*/tables.ts", () => {
    expect(patterns).toContain("convex/*/tables.ts");
    expect(readFileSync(".github/hot-files.txt", "utf8")).not.toContain("\r");
  });

  it.each([
    ["convex/schema.ts", "hot"],
    ["convex/notes/tables.ts", "hot"],
    ["convex/ai/providers/openai.ts", "hot"],
    ["src/components/ui/button.tsx", "hot"],
    ["package-lock.json", "hot"],
    [".github/workflows/ci.yml", "hot"],
    ["vite.config.ts", "hot"],
    ["tsconfig.app.json", "hot"],
    ["src/features/notes/List.tsx", "normal"],
    ["convex/notes/queries.ts", "normal"],
    ["convex/_generated/api.d.ts", "exempt"],
    ["convex/_generated/server.js", "exempt"],
    ["src/features/notes/vite.config.ts", "normal"],
  ])("classifies %s as %s", (path, expected) => {
    expect(classify(path, patterns)).toBe(expected);
  });
});

describe("parseArgs", () => {
  it("defaults to the branch diff", () => {
    expect(parseArgs([])).toEqual({ paths: null, strict: false });
  });

  it("collects globs after --paths and reads --strict", () => {
    expect(
      parseArgs(["--paths", "src/a/**", "convex/b.ts", "--strict"]),
    ).toEqual({ paths: ["src/a/**", "convex/b.ts"], strict: true });
  });

  it("rejects unknown options, stray arguments and an empty --paths", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["file.ts"])).toThrow(/Unexpected argument/);
    expect(() => parseArgs(["--paths"])).toThrow(/at least one glob/);
  });
});

describe("findOverlaps", () => {
  const others = [{ label: "PR #1", files: ["a.ts", "convex/schema.ts"] }];

  it("is empty without a shared file", () => {
    expect(findOverlaps({ mine: ["b.ts"], others, patterns })).toEqual([]);
    expect(formatOverlaps([])).toBe("No overlaps.");
  });

  it("matches --paths globs against other parties' files", () => {
    const result = findOverlaps({
      mine: { globs: ["convex/*.ts"] },
      others,
      patterns,
    });
    expect(result.map((o) => o.file)).toEqual(["convex/schema.ts"]);
  });

  it("marks hot files and leaves generated ones unmarked", () => {
    const result = findOverlaps({
      mine: ["convex/schema.ts", "convex/_generated/api.d.ts", "a.ts"],
      others: [
        {
          label: "lane x",
          files: ["convex/schema.ts", "convex/_generated/api.d.ts", "a.ts"],
        },
      ],
      patterns,
    });
    expect(result.map((o) => [o.file, o.level])).toEqual([
      ["a.ts", "normal"],
      ["convex/_generated/api.d.ts", "exempt"],
      ["convex/schema.ts", "hot"],
    ]);
    const text = formatOverlaps(result);
    expect(text).toContain("convex/schema.ts  [HOT]");
    expect(text).toContain("convex/_generated/api.d.ts  (generated)");
    expect(text).toContain("  - lane x");
  });
});

const porcelain = (...trees: [string, string][]) =>
  trees
    .map(([p, b]) => `worktree ${p}\nHEAD abc\nbranch refs/heads/${b}\n`)
    .join("\n");

function makeDeps(options: {
  mine?: string[];
  prs?: unknown;
  ghFails?: boolean;
  lanes?: Record<string, string[]>;
}) {
  const lanes = options.lanes ?? {};
  const trees = [
    ["F:/repo", "feat/mine"],
    ...Object.keys(lanes).map((p): [string, string] => [p, "feat/other"]),
  ] as [string, string][];
  const log = vi.fn();
  const warn = vi.fn();
  const output = vi.fn((command: string, args: string[], cwd: string) => {
    if (command === "gh") {
      if (options.ghFails) throw new Error("spawn gh ENOENT");
      return JSON.stringify(options.prs ?? []);
    }
    if (args.includes("--show-toplevel")) return "F:/repo\n";
    if (args.includes("--show-current")) return "feat/mine\n";
    if (args.includes("worktree")) return porcelain(...trees);
    if (args.includes("diff") && args.includes("origin/main...HEAD"))
      return ((cwd === "F:/repo" ? options.mine : lanes[cwd]) ?? []).join("\n");
    return "";
  });
  return { deps: { cwd: "F:/repo", output, patterns, log, warn }, log, warn };
}

const pr = (
  number: number,
  files: string[],
  headRefName = `feat/pr${number}`,
) => ({
  number,
  title: `Title ${number}`,
  author: { login: "ann" },
  headRefName,
  files: files.map((path) => ({ path })),
});

describe("runOverlap", () => {
  it("reports no overlap and exits 0", () => {
    const { deps, log } = makeDeps({
      mine: ["src/x.ts"],
      prs: [pr(1, ["src/y.ts"])],
    });
    expect(runOverlap(deps, { paths: null, strict: true }).exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith("No overlaps.");
  });

  it("lists an open PR touching my file, skipping my own branch's PR", () => {
    const { deps, log } = makeDeps({
      mine: ["src/x.ts"],
      prs: [pr(1, ["src/x.ts"]), pr(2, ["src/x.ts"], "feat/mine")],
    });
    const { exitCode, overlaps } = runOverlap(deps, {
      paths: null,
      strict: false,
    });
    expect(exitCode).toBe(0);
    expect(overlaps).toHaveLength(1);
    const text = String(log.mock.calls.at(-1)?.[0]);
    expect(text).toContain('PR #1 "Title 1" (@ann, feat/pr1)');
    expect(text).not.toContain("PR #2");
  });

  it("lists another local worktree touching my file", () => {
    const { deps, log } = makeDeps({
      mine: ["src/x.ts"],
      lanes: { "F:/repo-other": ["src/x.ts", "src/z.ts"] },
    });
    runOverlap(deps, { paths: null, strict: false });
    expect(String(log.mock.calls.at(-1)?.[0])).toContain(
      "lane feat/other (F:/repo-other)",
    );
  });

  it("--strict exits 1 only on a hot-file overlap", () => {
    const hot = makeDeps({
      mine: ["convex/schema.ts"],
      prs: [pr(1, ["convex/schema.ts"])],
    });
    expect(runOverlap(hot.deps, { paths: null, strict: true }).exitCode).toBe(
      1,
    );
    expect(runOverlap(hot.deps, { paths: null, strict: false }).exitCode).toBe(
      0,
    );

    const normal = makeDeps({ mine: ["src/x.ts"], prs: [pr(1, ["src/x.ts"])] });
    expect(
      runOverlap(normal.deps, { paths: null, strict: true }).exitCode,
    ).toBe(0);
  });

  it("uses --paths instead of the branch diff", () => {
    const { deps } = makeDeps({
      mine: [],
      prs: [pr(1, ["src/features/a/x.ts"])],
    });
    const { overlaps } = runOverlap(deps, {
      paths: ["src/features/a/**"],
      strict: false,
    });
    expect(overlaps.map((o) => o.file)).toEqual(["src/features/a/x.ts"]);
  });

  it("warns and still checks lanes when gh is missing", () => {
    const { deps, warn, log } = makeDeps({
      mine: ["src/x.ts"],
      ghFails: true,
      lanes: { "F:/repo-other": ["src/x.ts"] },
    });
    expect(runOverlap(deps, { paths: null, strict: true }).exitCode).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping open PRs"),
    );
    expect(String(log.mock.calls.at(-1)?.[0])).toContain("lane feat/other");
  });

  it("warns on unparseable gh output instead of failing", () => {
    const { deps, warn } = makeDeps({ mine: ["a.ts"], prs: { not: "a list" } });
    runOverlap(deps, { paths: null, strict: false });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Skipping open PRs"),
    );
  });
});
