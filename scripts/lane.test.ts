import type { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  deletionHint,
  deploymentReference,
  findLane,
  formatLanes,
  laneNew,
  laneRm,
  legacyAnonymousStateDir,
  localBackendPort,
  parseArgs,
  parseWorktrees,
  isPortInUse,
  pickLane,
  realDeps,
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
      convexPort: null,
      convexSitePort: null,
    });
  });

  it("gives a local lane its own Convex backend ports above the default 3210/3211", async () => {
    await expect(
      pickLane({ isPortFree: () => Promise.resolve(true), local: true }),
    ).resolves.toEqual({
      lane: 1,
      port: 5174,
      previewPort: 4174,
      convexPort: 3212,
      convexSitePort: 3213,
    });
  });

  it("skips a local lane whose Convex port is busy or reserved", async () => {
    const busy = new Set([3213]);
    await expect(
      pickLane({
        isPortFree: (p: number) => Promise.resolve(!busy.has(p)),
        reserved: [3214],
        local: true,
      }),
    ).resolves.toMatchObject({
      lane: 3,
      convexPort: 3216,
      convexSitePort: 3217,
    });
  });

  it("ignores Convex ports for cloud lanes", async () => {
    const busy = new Set([3212, 3213]);
    await expect(
      pickLane({ isPortFree: (p: number) => Promise.resolve(!busy.has(p)) }),
    ).resolves.toMatchObject({ lane: 1 });
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
        convexPort: null,
        convexSitePort: null,
      },
    ]);
  });

  it("reads a local lane's Convex backend ports from its URLs", () => {
    const [lane] = toLanes(parseWorktrees(PORCELAIN), () => ({
      CONVEX_DEPLOYMENT: "anonymous:anonymous-app-12-login",
      VITE_CONVEX_URL: "http://127.0.0.1:3212",
      VITE_CONVEX_SITE_URL: "http://127.0.0.1:3213",
    }));
    expect(lane).toMatchObject({ convexPort: "3212", convexSitePort: "3213" });
    const out = formatLanes(lane ? [lane] : []);
    expect(out.split("\n")[0]).toContain("CONVEX PORTS");
    expect(out).toContain("3212/3213");
  });

  it.each([
    ["http://127.0.0.1:3212", "3212"],
    ["http://localhost:3214", "3214"],
    ["https://happy-fox-123.convex.cloud", null],
    ["http://127.0.0.1", null],
    ["", null],
    [undefined, null],
    ["not a url", null],
  ])("localBackendPort(%s) is %s", (url, port) => {
    expect(localBackendPort(url)).toBe(port);
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
    expect(hint).toMatch(/NOT deleted/);
    expect(hint).toMatch(/Convex dashboard/);
    expect(hint).toMatch(/in 7 days/);
    expect(hint).not.toMatch(/deployment delete/);
  });

  it.each(["local:happy-fox-123", "anonymous:anonymous-agent"])(
    "says %s lanes are removed with the worktree",
    (deployment) => {
      const [lane] = toLanes(parseWorktrees(PORCELAIN), () => ({
        CONVEX_DEPLOYMENT: deployment,
      }));
      const hint = lane ? deletionHint(lane).replaceAll("\\", "/") : "";
      expect(hint).toContain("F:/work/app-12-login/.convex/local/default");
      expect(hint).toMatch(/removed with the worktree/);
      expect(hint).not.toMatch(/NOT deleted/);
    },
  );
});

function makeDeps(overrides: Partial<Parameters<typeof laneNew>[0]> = {}) {
  const calls: {
    command: string;
    args: string[];
    cwd: string;
    env?: Record<string, string>;
    stdin?: "ignore";
  }[] = [];
  const logs: string[] = [];
  const written: { dir: string; values: Record<string, string | number> }[] =
    [];
  const deps = {
    cwd: "F:/work/app",
    home: "F:/no-such-home",
    run: (
      command: string,
      args: string[],
      {
        cwd,
        env,
        stdin,
      }: { cwd: string; env?: Record<string, string>; stdin?: "ignore" },
    ) => {
      calls.push({
        command,
        args,
        cwd,
        ...(env ? { env } : {}),
        ...(stdin ? { stdin } : {}),
      });
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

  it("creates an anonymous local deployment on its own ports with convex dev --once when --local", async () => {
    const { deps, calls, written } = makeDeps();
    const result = await laneNew(deps, { ...args, local: true });
    expect(calls.map((c) => [c.command, c.args[0]])).toEqual([
      ["git", "worktree"],
      ["npm", "ci"],
      [process.execPath, expect.stringContaining("main.js")],
    ]);
    expect(calls[2]?.args.slice(1)).toEqual([
      "dev",
      "--once",
      "--local-cloud-port",
      "3214",
      "--local-site-port",
      "3215",
    ]);
    expect(calls[2]?.cwd).toBe(result.lanePath);
    expect(calls[2]?.stdin).toBe("ignore");
    expect(calls[2]?.env).toEqual({
      CONVEX_AGENT_MODE: "",
      CONVEX_ALLOW_ANONYMOUS: "",
      CONVEX_DEPLOYMENT: "",
      CONVEX_DEPLOY_KEY: "",
      CONVEX_DEPLOYMENT_TOKEN: "",
      CONVEX_SELF_HOSTED_URL: "",
      CONVEX_SELF_HOSTED_ADMIN_KEY: "",
    });
    expect(written).toEqual([
      { dir: result.lanePath, values: { PORT: 5175, PREVIEW_PORT: 4175 } },
      { dir: result.lanePath, values: { CONVEX_AGENT_MODE: "anonymous" } },
    ]);
  });

  it("does not pass the anonymous env, stdin or local ports to cloud lanes", async () => {
    const { deps, calls } = makeDeps();
    const result = await laneNew(deps, args);
    expect(calls[2]?.env).toBeUndefined();
    expect(calls[2]?.stdin).toBeUndefined();
    expect(calls[2]?.args.join(" ")).not.toMatch(/--local-/);
    expect(result).toMatchObject({ convexPort: null, convexSitePort: null });
  });

  it("does not reuse Convex ports another lane already holds", async () => {
    const { deps, calls } = makeDeps({
      readEnv: (path: string): Record<string, string> =>
        path.endsWith("12-login")
          ? {
              PORT: "5174",
              PREVIEW_PORT: "4174",
              VITE_CONVEX_URL: "http://127.0.0.1:3214",
              VITE_CONVEX_SITE_URL: "http://127.0.0.1:3215",
            }
          : {},
    });
    const result = await laneNew(deps, { ...args, local: true });
    expect(result).toMatchObject({
      port: 5176,
      convexPort: 3216,
      convexSitePort: 3217,
    });
    expect(calls[2]?.args).toContain("3216");
  });

  it("refuses a local lane whose name has legacy home-directory state", async () => {
    const home = mkdtempSync(join(tmpdir(), "lane-home-"));
    try {
      const { deps, calls } = makeDeps({ home });
      const lanePath = join("F:/work", "app-7-search");
      mkdirSync(legacyAnonymousStateDir(home, lanePath), { recursive: true });
      await expect(laneNew(deps, { ...args, local: true })).rejects.toThrow(
        /anonymous-convex-backend-state.*would reuse/,
      );
      expect(calls).toEqual([]);
      await expect(laneNew(deps, args)).resolves.toBeDefined();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("names the legacy state directory after the worktree directory", () => {
    expect(
      legacyAnonymousStateDir("/home/u", "/work/app-7-search").replaceAll(
        "\\",
        "/",
      ),
    ).toBe(
      "/home/u/.convex/anonymous-convex-backend-state/anonymous-app-7-search",
    );
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

  function recordOrder(failOn: string) {
    const order: string[] = [];
    const { deps } = makeDeps({
      run: (command: string) => {
        const name = command === process.execPath ? "convex" : command;
        order.push(name);
        return name === failOn ? 1 : 0;
      },
      writeEnv: (_dir: string, values: Record<string, string | number>) => {
        order.push(JSON.stringify(values));
      },
    });
    return { deps, order };
  }
  const portsEnv = JSON.stringify({ PORT: 5175, PREVIEW_PORT: 4175 });
  const agentEnv = JSON.stringify({ CONVEX_AGENT_MODE: "anonymous" });

  it("writes a --local lane's ports before npm ci and agent mode only after the deployment exists", async () => {
    const ok = recordOrder("none");
    await laneNew(ok.deps, { ...args, local: true });
    expect(ok.order).toEqual(["git", portsEnv, "npm", "convex", agentEnv]);

    const failedNpm = recordOrder("npm");
    await expect(
      laneNew(failedNpm.deps, { ...args, local: true }),
    ).rejects.toThrow(/npm ci/);
    expect(failedNpm.order).toEqual(["git", portsEnv, "npm"]);

    const failedConvex = recordOrder("convex");
    await expect(
      laneNew(failedConvex.deps, { ...args, local: true }),
    ).rejects.toThrow(/dev --once/);
    expect(failedConvex.order).toEqual(["git", portsEnv, "npm", "convex"]);
  });
});

describe("laneRm", () => {
  it("removes the worktree and only prints the deletion command", () => {
    const { deps, calls, logs } = makeDeps({
      readEnv: () => ({
        PORT: "5174",
        PREVIEW_PORT: "4174",
        CONVEX_DEPLOYMENT: "dev:happy-fox-123",
      }),
    });
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

  it.each([
    ["a local lane", { CONVEX_DEPLOYMENT: "anonymous:anonymous-agent" }],
    [
      "a --local lane whose creation failed",
      { PORT: "5175", PREVIEW_PORT: "4175" },
    ],
  ])("does not claim the deployment of %s survives", (_label, env) => {
    const { deps, logs } = makeDeps({ readEnv: () => env });
    laneRm(deps, { command: "rm", slug: "12-login", force: false });
    const log = logs.join("\n");
    expect(log).toMatch(/removed with the worktree/);
    expect(log).not.toMatch(/NOT deleted/);
  });

  it.each([
    [
      "a cloud deployment wins over a stray agent-mode line",
      {
        CONVEX_DEPLOYMENT: "dev:happy-fox-123",
        CONVEX_AGENT_MODE: "anonymous",
      },
    ],
    ["a lane with no env at all", {}],
  ])("keeps the cloud hint for %s", (_label, env) => {
    const { deps, logs } = makeDeps({ readEnv: () => env });
    laneRm(deps, { command: "rm", slug: "12-login", force: false });
    expect(logs.join("\n")).toMatch(/NOT deleted/);
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

describe("realDeps().run", () => {
  const exitUnlessBlank = [
    "-e",
    "process.exit(process.env.CONVEX_DEPLOYMENT === '' ? 0 : 7)",
  ];

  it("lets an env override beat a value inherited from the shell", () => {
    vi.stubEnv("CONVEX_DEPLOYMENT", "dev:inherited-123");
    try {
      const { run } = realDeps();
      const cwd = process.cwd();
      expect(run(process.execPath, exitUnlessBlank, { cwd })).toBe(7);
      expect(
        run(process.execPath, exitUnlessBlank, {
          cwd,
          env: { CONVEX_DEPLOYMENT: "" },
        }),
      ).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("hands stdin: ignore to the spawn as the child's stdin, and inherits it otherwise", () => {
    const stdio: unknown[] = [];
    const spawn = ((
      _command: string,
      _args: string[],
      options: { stdio: unknown },
    ) => {
      stdio.push(options.stdio);
      return { status: 0 };
    }) as unknown as typeof spawnSync;
    const { run } = realDeps({ spawn });
    const cwd = process.cwd();
    run(process.execPath, [], { cwd, stdin: "ignore" });
    run(process.execPath, [], { cwd });
    expect(stdio).toEqual([
      ["ignore", "inherit", "inherit"],
      ["inherit", "inherit", "inherit"],
    ]);
  });
});

describe("isPortInUse", () => {
  async function listenOn(host: string) {
    const server = createServer();
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen({ port: 0, host }, ok);
    });
    return server;
  }
  const portOf = (server: Server) => (server.address() as AddressInfo).port;
  const close = (server: Server) =>
    new Promise<void>((done) => server.close(() => done()));

  it.each(["127.0.0.1", "0.0.0.0", "::1", "::"])(
    "sees a listener bound to %s",
    async (host) => {
      let server: Server;
      try {
        server = await listenOn(host);
      } catch {
        return; // no IPv6 on this machine
      }
      try {
        await expect(isPortInUse(portOf(server))).resolves.toBe(true);
      } finally {
        await close(server);
      }
    },
  );

  it("reports a closed port as free", async () => {
    const server = await listenOn("127.0.0.1");
    const port = portOf(server);
    await close(server);
    await expect(isPortInUse(port)).resolves.toBe(false);
  });
});
