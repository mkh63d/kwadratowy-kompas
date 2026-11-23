import { describe, expect, it, vi } from "vitest";
import {
  deletionHint,
  deploymentReference,
  findLane,
  formatLanes,
  laneNew,
  laneRm,
  parseArgs,
  parseWorktrees,
  pickLane,
  toLanes,
  upsertEnv,
} from "./lane.mjs";

describe("parseArgs", () => {
  it("parses lane:new with and without --local", () => {
    expect(parseArgs(["new", "ann", "12", "login"])).toEqual({
      command: "new",
      member: "ann",
      issue: "12",
      slug: "login",
      local: false,
    });
    expect(parseArgs(["new", "ann", "12", "login", "--local"])).toMatchObject({
      local: true,
    });
    expect(parseArgs(["new", "--local", "ann", "12", "login"])).toMatchObject({
      member: "ann",
      local: true,
    });
  });

  it("rejects missing, extra and unknown arguments", () => {
    expect(() => parseArgs(["new", "ann", "12"])).toThrow(/needs/);
    expect(() => parseArgs(["new", "a", "1", "b", "c"])).toThrow(/needs/);
    expect(() => parseArgs(["new", "a", "1", "b", "--wat"])).toThrow(
      /Unknown option/,
    );
    expect(() => parseArgs([])).toThrow(/Unknown command/);
    expect(() => parseArgs(["nope"])).toThrow(/Unknown command/);
  });

  it("parses list and rm", () => {
    expect(parseArgs(["list"])).toEqual({ command: "list" });
    expect(() => parseArgs(["list", "x"])).toThrow();
    expect(parseArgs(["rm", "12-login"])).toEqual({
      command: "rm",
      slug: "12-login",
      force: false,
    });
    expect(parseArgs(["rm", "12-login", "--force"])).toMatchObject({
      force: true,
    });
    expect(() => parseArgs(["rm"])).toThrow(/exactly one/);
  });
});

describe("deploymentReference", () => {
  it("builds dev/<member>/<issue>-<slug>", () => {
    expect(
      deploymentReference({ member: "ann", issue: "12", slug: "login-form" }),
    ).toBe("dev/ann/12-login-form");
  });

  it.each([
    ["member", { member: "a/b", issue: "1", slug: "x" }],
    ["issue", { member: "a", issue: "1 2", slug: "x" }],
    ["slug", { member: "a", issue: "1", slug: "wąż" }],
    ["slug", { member: "a", issue: "1", slug: "a_b" }],
    ["slug", { member: "a", issue: "1", slug: "" }],
  ])("rejects an invalid %s", (_label, lane) => {
    expect(() => deploymentReference(lane)).toThrow(/Invalid/);
  });

  it("enforces the 100-character limit", () => {
    const ok = "x".repeat(100 - "dev/a/1-".length);
    expect(
      deploymentReference({ member: "a", issue: "1", slug: ok }),
    ).toHaveLength(100);
    expect(() =>
      deploymentReference({ member: "a", issue: "1", slug: `${ok}x` }),
    ).toThrow(/3-100/);
  });
});

describe("pickLane", () => {
  it("returns lane 1 when everything is free", async () => {
    await expect(
      pickLane({ isPortFree: () => Promise.resolve(true) }),
    ).resolves.toEqual({
      lane: 1,
      port: 5174,
      previewPort: 4174,
    });
  });

  it("skips lanes with a busy dev or preview port", async () => {
    const busy = new Set([5174, 4175]);
    const isPortFree = vi.fn((p: number) => Promise.resolve(!busy.has(p)));
    await expect(pickLane({ isPortFree })).resolves.toMatchObject({ lane: 3 });
  });

  it("skips ports reserved by other lanes even when they are free now", async () => {
    await expect(
      pickLane({
        isPortFree: () => Promise.resolve(true),
        reserved: [5174, 4175],
      }),
    ).resolves.toMatchObject({ lane: 3, port: 5176, previewPort: 4176 });
  });

  it("throws when nothing is free", async () => {
    await expect(
      pickLane({ isPortFree: () => Promise.resolve(false) }),
    ).rejects.toThrow(/No free lane/);
  });
});

describe("upsertEnv", () => {
  it("appends to existing content and keeps it", () => {
    expect(upsertEnv("A=1\nB=2\n", { PORT: 5174, PREVIEW_PORT: 4174 })).toBe(
      "A=1\nB=2\nPORT=5174\nPREVIEW_PORT=4174\n",
    );
  });

  it("replaces existing keys and normalises CRLF", () => {
    expect(upsertEnv("PORT=1\r\nA=1", { PORT: 2 })).toBe("PORT=2\nA=1\n");
  });

  it("works on an empty file", () => {
    expect(upsertEnv("", { PORT: 1 })).toBe("PORT=1\n");
  });
});

const PORCELAIN = [
  "worktree F:/work/app\nHEAD aaa\nbranch refs/heads/main",
  "worktree F:/work/app-12-login\nHEAD bbb\nbranch refs/heads/feat/12-login",
  "worktree F:/work/app-scratch\nHEAD ccc\nbranch refs/heads/spike",
  "worktree F:/work/app-detached\nHEAD ddd\ndetached",
].join("\n\n");

describe("lanes", () => {
  const readEnv = (path: string): Record<string, string> =>
    path.endsWith("12-login")
      ? {
          PORT: "5174",
          PREVIEW_PORT: "4174",
          CONVEX_DEPLOYMENT: "dev:happy-fox-123 # team: t, project: p",
        }
      : {};

  it("parses porcelain output including detached heads", () => {
    expect(parseWorktrees(PORCELAIN)).toEqual([
      { path: "F:/work/app", branch: "main" },
      { path: "F:/work/app-12-login", branch: "feat/12-login" },
      { path: "F:/work/app-scratch", branch: "spike" },
      { path: "F:/work/app-detached", branch: null },
    ]);
  });

  it("treats only non-main feat/* worktrees as lanes", () => {
    const lanes = toLanes(parseWorktrees(PORCELAIN), readEnv);
    expect(lanes).toEqual([
      {
        slug: "12-login",
        path: "F:/work/app-12-login",
        branch: "feat/12-login",
        port: "5174",
        previewPort: "4174",
        deployment: "dev:happy-fox-123 # team: t, project: p",
      },
    ]);
  });

  it("formats a table and an empty state", () => {
    expect(formatLanes([])).toBe("No lanes.");
    const out = formatLanes(toLanes(parseWorktrees(PORCELAIN), readEnv));
    expect(out).toContain("12-login");
    expect(out).toContain("5174");
    expect(out.split("\n")).toHaveLength(2);
  });

  it("finds a lane by slug or explains what exists", () => {
    const lanes = toLanes(parseWorktrees(PORCELAIN), readEnv);
    expect(findLane("12-login", lanes).path).toBe("F:/work/app-12-login");
    expect(() => findLane("nope", lanes)).toThrow(/Known lanes: 12-login/);
  });

  it("points cloud lanes at the dashboard or expiry, never a CLI delete", () => {
    const [lane] = toLanes(parseWorktrees(PORCELAIN), readEnv);
    const hint = lane ? deletionHint(lane) : "";
    expect(hint).toMatch(/Convex dashboard/);
    expect(hint).toMatch(/in 7 days/);
    expect(hint).not.toMatch(/deployment delete/);
  });

  it("says local lanes are removed with the worktree", () => {
    const [lane] = toLanes(parseWorktrees(PORCELAIN), () => ({
      CONVEX_DEPLOYMENT: "local:happy-fox-123",
    }));
    const hint = lane ? deletionHint(lane).replaceAll("\\", "/") : "";
    expect(hint).toContain("F:/work/app-12-login/.convex/local/default");
    expect(hint).toMatch(/removed with the worktree/);
  });
});

function makeDeps(overrides: Partial<Parameters<typeof laneNew>[0]> = {}) {
  const calls: { command: string; args: string[]; cwd: string }[] = [];
  const logs: string[] = [];
  const written: { dir: string; values: Record<string, string | number> }[] =
    [];
  const deps = {
    cwd: "F:/work/app",
    run: (command: string, args: string[], { cwd }: { cwd: string }) => {
      calls.push({ command, args, cwd });
      return 0;
    },
    output: () => PORCELAIN,
    isPortFree: () => Promise.resolve(true),
    readEnv: (path: string): Record<string, string> =>
      path.endsWith("12-login") ? { PORT: "5174", PREVIEW_PORT: "4174" } : {},
    writeEnv: (dir: string, values: Record<string, string | number>) => {
      written.push({ dir, values });
    },
    log: (message: string) => {
      logs.push(message);
    },
    ...overrides,
  };
  return { deps, calls, logs, written };
}

describe("laneNew", () => {
  const args = {
    command: "new" as const,
    member: "ann",
    issue: "7",
    slug: "search",
    local: false,
  };

  it("creates the worktree, installs, creates the cloud deployment and writes ports", async () => {
    const { deps, calls, written } = makeDeps();
    const result = await laneNew(deps, args);

    const lanePath = result.lanePath.replaceAll("\\", "/");
    expect(lanePath.endsWith("/work/app-7-search")).toBe(true);
    expect(calls.map((c) => [c.command, c.args[0]])).toEqual([
      ["git", "worktree"],
      ["npm", "ci"],
      [process.execPath, expect.stringContaining("main.js")],
    ]);
    expect(calls[0]?.args).toEqual([
      "worktree",
      "add",
      "-b",
      "feat/7-search",
      result.lanePath,
    ]);
    expect(calls[2]?.args.slice(1)).toEqual([
      "deployment",
      "create",
      "dev/ann/7-search",
      "--type",
      "dev",
      "--select",
      "--expiration",
      "in 7 days",
    ]);
    expect(calls[2]?.cwd).toBe(result.lanePath);
    expect(result).toMatchObject({ port: 5175, previewPort: 4175 });
    expect(written).toEqual([
      {
        dir: result.lanePath,
        values: { PORT: 5175, PREVIEW_PORT: 4175 },
      },
    ]);
  });

  it("uses the local deployment reference with --local", async () => {
    const { deps, calls } = makeDeps();
    await laneNew(deps, { ...args, local: true });
    expect(calls[2]?.args.slice(1)).toEqual([
      "deployment",
      "create",
      "local",
      "--select",
    ]);
  });

  it("validates before touching git", async () => {
    const { deps, calls } = makeDeps();
    await expect(laneNew(deps, { ...args, slug: "bad slug" })).rejects.toThrow(
      /Invalid slug/,
    );
    expect(calls).toEqual([]);
  });

  it("stops at the first failing step", async () => {
    const { deps, written } = makeDeps({
      run: (command: string) => (command === "npm" ? 1 : 0),
    });
    await expect(laneNew(deps, args)).rejects.toThrow(/npm ci/);
    expect(written).toEqual([]);
  });
});

describe("laneRm", () => {
  it("removes the worktree and only prints the deletion command", () => {
    const { deps, calls, logs } = makeDeps();
    laneRm(deps, { command: "rm", slug: "12-login", force: false });
    expect(calls).toEqual([
      {
        command: "git",
        args: ["worktree", "remove", "F:/work/app-12-login"],
        cwd: "F:/work/app",
      },
    ]);
    expect(logs.join("\n")).toMatch(/NOT deleted/);
    expect(logs.join("\n")).not.toMatch(/deployment delete/);
    expect(logs.join("\n")).toMatch(/Convex dashboard/);
  });

  it("passes --force through and reports a failed removal", () => {
    const seen: string[][] = [];
    const { deps } = makeDeps({
      run: (_command: string, a: string[]) => {
        seen.push(a);
        return 1;
      },
    });
    expect(() =>
      laneRm(deps, { command: "rm", slug: "12-login", force: true }),
    ).toThrow(/Re-run with --force/);
    expect(seen).toEqual([
      ["worktree", "remove", "--force", "F:/work/app-12-login"],
    ]);
  });
});
