import { describe, expect, it } from "vitest";
import {
  convexProjectSlug,
  hasCloudDeployment,
  nodeVersionSupported,
  parseArgs,
  parseGithubSlug,
  pinnedVercel,
  RULESET_NAME,
  rulesetPayload,
  rulesetTargetsMain,
  runSetup,
} from "./setup-deploy.mjs";

type Call = {
  command: string;
  args: string[];
  input?: string;
  interactive?: boolean;
};
type Result = { status: number; stdout: string; stderr: string };

const DEPLOY_KEY = "prod:happy-otter-123|SUPERSECRETKEYVALUE";
const VERCEL_TOKEN = "vercel-token-abc987";
const ok = (stdout = ""): Result => ({ status: 0, stdout, stderr: "" });
const bad = (stderr = ""): Result => ({ status: 1, stdout: "", stderr });

const DEPLOY_YML = "run: npx vercel@65.16.0 pull";
const MATCHING_ENV =
  "CONVEX_DEPLOYMENT=dev:cool-fox-1 # team: t, project: my-hack";
const PROJECT_JSON = JSON.stringify({ orgId: "team_1", projectId: "prj_1" });

interface World {
  isTemplate?: boolean;
  ghLoggedIn?: boolean;
  convexLoggedIn?: boolean;
  vercelLoggedIn?: boolean;
  secrets?: string[];
  envExists?: boolean;
  rulesets?: string[];
  rulesetRefs?: string[];
  nodeVersion?: string;
  origin?: string;
  files?: Record<string, string>;
  keyOutput?: string;
  failSecretSet?: boolean;
  envProbeError?: string;
  vercelProjectExists?: boolean;
  vercelProjectId?: string;
  tokenError?: string;
  inspectError?: string;
  agentNotFound?: boolean;
  declineConvexProject?: boolean;
}

const AGENT_NOT_FOUND: Result = {
  status: 1,
  stdout: `${JSON.stringify(
    {
      status: "error",
      reason: "project_not_found",
      message: 'There is no project for "my-hack"',
    },
    null,
    2,
  )}\n`,
  stderr: "",
};

function setup(world: World = {}, argv: string[] = ["--yes"]) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const questions: string[] = [];
  const files: Record<string, string> = {
    [".github/workflows/deploy.yml"]: DEPLOY_YML,
    ...world.files,
  };
  const key = (p: string) => p.replaceAll("\\", "/");
  let projectCreated = false;

  const run = (
    command: string,
    args: string[],
    options?: { input?: string; interactive?: boolean },
  ) => {
    calls.push({
      command,
      args,
      input: options?.input,
      interactive: options?.interactive,
    });
    const line = args.join(" ");
    if (command === "git")
      return ok(`${world.origin ?? "https://github.com/team/my-hack.git"}
`);
    if (command === "gh") {
      if (line.startsWith("auth status"))
        return world.ghLoggedIn === false ? bad("not logged in") : ok();
      if (line.startsWith("repo view team/my-hack "))
        return ok(
          JSON.stringify({
            isTemplate: world.isTemplate ?? false,
            name: "my-hack",
            nameWithOwner: "team/my-hack",
          }),
        );
      if (line.startsWith("secret list"))
        return !world.envExists
          ? bad("HTTP 404: Not Found")
          : ok(JSON.stringify((world.secrets ?? []).map((name) => ({ name }))));
      if (line === "api repos/team/my-hack/environments/production")
        return world.envProbeError
          ? bad(world.envProbeError)
          : world.envExists
            ? ok("{}")
            : bad("gh: Not Found (HTTP 404)");
      if (line.includes("--method PUT")) return ok();
      if (line === "api repos/team/my-hack/rulesets")
        return ok(
          JSON.stringify(
            (world.rulesets ?? []).map((name, i) => ({
              id: i + 1,
              name,
              target: "branch",
              enforcement: "active",
            })),
          ),
        );
      if (line.startsWith("api repos/team/my-hack/rulesets/"))
        return ok(
          JSON.stringify({
            conditions: {
              ref_name: {
                include: world.rulesetRefs ?? ["refs/heads/main"],
              },
            },
          }),
        );
      if (line.includes("--method POST")) return ok();
      if (line.startsWith("secret set"))
        return world.failSecretSet
          ? bad(`boom while sending ${options?.input}`)
          : ok();
    }
    if (line.includes("login status"))
      return world.convexLoggedIn === false ? bad("no") : ok();
    if (command === "npx" && line.endsWith("whoami"))
      return world.vercelLoggedIn === false ? bad("no") : ok("me");
    if (command === "npx" && line.includes("project inspect"))
      return world.inspectError
        ? bad(world.inspectError)
        : world.vercelProjectExists === false && !projectCreated
          ? world.agentNotFound
            ? AGENT_NOT_FOUND
            : bad('Error: There is no project for "my-hack"')
          : ok(JSON.stringify({ id: world.vercelProjectId ?? "prj_1" }));
    if (command === "npx" && line.includes(" link ")) {
      files[key(".vercel/project.json")] ??= PROJECT_JSON;
      return ok();
    }
    if (command === "npx" && line.includes("project create")) {
      projectCreated = true;
      return ok();
    }
    if (line.includes("token create"))
      return world.tokenError
        ? bad(world.tokenError)
        : ok(`${world.keyOutput ?? DEPLOY_KEY}\n`);
    return ok();
  };

  return {
    calls,
    logs,
    files,
    questions,
    exec: (args = argv) =>
      runSetup(args, {
        run,
        log: (l) => logs.push(l),
        confirm: (q) => {
          questions.push(q);
          return Promise.resolve(
            !(world.declineConvexProject && q.startsWith("Użyć projektu")),
          );
        },
        readSecret: () => Promise.resolve(VERCEL_TOKEN),
        readFile: (p) => files[key(p)] ?? null,
        nodeVersion: world.nodeVersion ?? "v24.22.3",
      }),
    secretSets: () =>
      calls.filter(
        (c) =>
          c.command === "gh" && c.args[0] === "secret" && c.args[1] === "set",
      ),
    mutations: () =>
      calls.filter(
        (c) =>
          (c.command === "gh" &&
            (c.args[0] === "secret"
              ? c.args[1] === "set"
              : c.args.includes("--method"))) ||
          c.args.some((a) => ["link", "create", "dev"].includes(a)),
      ),
  };
}

describe("parseArgs and helpers", () => {
  it("parses flags and rejects unknown ones", () => {
    expect(parseArgs(["--dry-run", "--protect"])).toEqual({
      dryRun: true,
      protect: true,
      yes: false,
    });
    expect(() => parseArgs(["--nope"])).toThrow(/Nieznana opcja/);
  });

  it("reads the pinned vercel version from deploy.yml", () => {
    expect(pinnedVercel(DEPLOY_YML)).toBe("65.16.0");
    expect(() => pinnedVercel("nothing")).toThrow();
  });

  it("detects only cloud deployments in .env.local", () => {
    expect(hasCloudDeployment(null)).toBe(false);
    expect(
      hasCloudDeployment("CONVEX_DEPLOYMENT=dev:cool-fox-1 # team: t"),
    ).toBe(true);
    expect(
      hasCloudDeployment("CONVEX_DEPLOYMENT=anonymous:anonymous-agent"),
    ).toBe(false);
    expect(hasCloudDeployment("CONVEX_DEPLOYMENT=local:local-me")).toBe(false);
    expect(hasCloudDeployment("OTHER=1")).toBe(false);
  });

  it("treats a ruleset as covering main unless main is excluded", () => {
    expect(
      rulesetTargetsMain({
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"] } },
      }),
    ).toBe(true);
    expect(
      rulesetTargetsMain({
        conditions: {
          ref_name: { include: ["~ALL"], exclude: ["refs/heads/main"] },
        },
      }),
    ).toBe(false);
    expect(
      rulesetTargetsMain({
        conditions: {
          ref_name: {
            include: ["~ALL"],
            exclude: ["refs/heads/release"],
          },
        },
      }),
    ).toBe(true);
    expect(rulesetTargetsMain({})).toBe(false);
  });

  it("matches ref globs in include and exclude", () => {
    const targets = (include: string[], exclude: string[] = []) =>
      rulesetTargetsMain({ conditions: { ref_name: { include, exclude } } });
    expect(targets(["refs/heads/*"])).toBe(true);
    expect(targets(["refs/heads/feat/*"])).toBe(false);
    expect(targets(["~ALL"], ["refs/heads/ma*"])).toBe(false);
    expect(targets(["refs/heads/*"], ["refs/heads/release/*"])).toBe(true);
  });

  it("accepts only Node >=24.15 and <25", () => {
    expect(nodeVersionSupported("v24.14.0")).toBe(false);
    expect(nodeVersionSupported("v24.15.0")).toBe(true);
    expect(nodeVersionSupported("v24.22.3")).toBe(true);
    expect(nodeVersionSupported("v25.0.0")).toBe(false);
    expect(nodeVersionSupported("v22.20.0")).toBe(false);
  });

  it("reads the project slug convex writes next to CONVEX_DEPLOYMENT", () => {
    expect(convexProjectSlug(MATCHING_ENV)).toBe("my-hack");
    expect(convexProjectSlug("CONVEX_DEPLOYMENT=dev:x")).toBeNull();
    expect(convexProjectSlug(null)).toBeNull();
  });

  it("builds the ruleset from ARCH 10.3", () => {
    const payload = rulesetPayload();
    expect(payload.name).toBe(RULESET_NAME);
    expect(payload.conditions.ref_name.include).toEqual(["refs/heads/main"]);
    const types = payload.rules.map((r) => r.type);
    expect(types).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
      "merge_queue",
    ]);
    const pr = payload.rules.find((r) => r.type === "pull_request");
    expect(pr?.parameters?.allowed_merge_methods).toEqual(["squash"]);
    const checks = payload.rules.find(
      (r) => r.type === "required_status_checks",
    );
    expect(checks?.parameters?.required_status_checks).toEqual([
      { context: "gate" },
    ]);
  });
});

describe("runSetup", () => {
  it("refuses to run on the template repository and changes nothing", async () => {
    const w = setup({ isTemplate: true }, ["--dry-run"]);
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toMatch(/repozytorium-szablon/);
    expect(w.mutations()).toEqual([]);
    expect(w.calls.some((c) => c.args.includes("whoami"))).toBe(false);
  });

  it.each([
    ["gh", { ghLoggedIn: false }, /gh auth login/],
    ["convex", { convexLoggedIn: false }, /npx convex login/],
    ["vercel", { vercelLoggedIn: false }, /vercel@65\.16\.0 login/],
  ])("explains a missing %s login", async (_name, world, message) => {
    const w = setup(world);
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toMatch(message);
    expect(w.secretSets()).toEqual([]);
  });

  it.each(["v24.14.0", "v25.0.0"])("rejects Node %s", async (nodeVersion) => {
    const w = setup({ nodeVersion });
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toMatch(/Potrzebny Node 24/);
    expect(w.calls).toEqual([]);
  });

  it("runs on Node 24.15.0", async () => {
    const w = setup({
      nodeVersion: "v24.15.0",
      files: { ".vercel/project.json": PROJECT_JSON },
    });
    expect(await w.exec()).toBe(0);
  });

  it.each([
    ["other project", "# team: t, project: other-hack", "other-hack"],
    ["undeterminable", "", "nieznany"],
  ])(
    "aborts without minting a key when .env.local is %s",
    async (_name, comment, shown) => {
      const env = `CONVEX_DEPLOYMENT=dev:cool-fox-1 ${comment}`;
      for (const argv of [["--yes"], ["--dry-run"]]) {
        const w = setup(
          {
            files: { ".env.local": env, ".vercel/project.json": PROJECT_JSON },
          },
          argv,
        );
        expect(await w.exec()).toBe(1);
        const out = w.logs.join("\n");
        expect(out).toContain(`„${shown}”`);
        expect(out).toMatch(/bez --yes/);
        expect(out).toContain("convex dev --configure new");
        expect(w.questions.some((q) => q.startsWith("Użyć projektu"))).toBe(
          false,
        );
        expect(w.calls.some((c) => c.args.includes("token"))).toBe(false);
        expect(w.secretSets()).toEqual([]);
      }
    },
  );

  const OTHER_ENV =
    "CONVEX_DEPLOYMENT=dev:cool-fox-1 # team: t, project: my-hack-2";

  it("asks before reusing a Convex project with another slug and mints a key on yes", async () => {
    const w = setup(
      {
        files: {
          ".env.local": OTHER_ENV,
          ".vercel/project.json": PROJECT_JSON,
        },
      },
      [],
    );
    expect(await w.exec()).toBe(0);
    expect(w.questions).toContain(
      "Użyć projektu Convex „my-hack-2” dla repozytorium „my-hack”?",
    );
    expect(w.calls.some((c) => c.args.includes("token"))).toBe(true);
    expect(w.calls.some((c) => c.args.includes("--configure"))).toBe(false);
  });

  it("aborts without minting a key when the other Convex project is declined", async () => {
    const w = setup(
      {
        declineConvexProject: true,
        files: {
          ".env.local": OTHER_ENV,
          ".vercel/project.json": PROJECT_JSON,
        },
      },
      [],
    );
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toContain("„my-hack-2”");
    expect(w.calls.some((c) => c.args.includes("token"))).toBe(false);
    expect(w.secretSets()).toEqual([]);
  });

  it("does not ask about an undeterminable Convex project interactively", async () => {
    const w = setup(
      {
        files: {
          ".env.local": "CONVEX_DEPLOYMENT=dev:cool-fox-1",
          ".vercel/project.json": PROJECT_JSON,
        },
      },
      [],
    );
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toContain("„nieznany”");
    expect(w.questions.some((q) => q.startsWith("Użyć projektu"))).toBe(false);
    expect(w.calls.some((c) => c.args.includes("token"))).toBe(false);
  });

  it("dry-run plans everything and changes nothing", async () => {
    const w = setup({}, ["--dry-run", "--protect"]);
    expect(await w.exec()).toBe(0);
    const out = w.logs.join("\n");
    expect(out).toMatch(/\[dry-run\] Convex: tworzę projekt/);
    expect(out).toMatch(/\[dry-run\] GitHub: ustawiam sekret VERCEL_TOKEN/);
    expect(out).toMatch(/\[dry-run\] GitHub: tworzę ruleset/);
    expect(w.mutations()).toEqual([]);
  });

  it("sets all four secrets through stdin only, never argv or logs", async () => {
    const w = setup({ files: { ".vercel/project.json": PROJECT_JSON } });
    expect(await w.exec()).toBe(0);
    const sets = w.secretSets();
    expect(sets.map((c) => c.args[2]).sort()).toEqual([
      "CONVEX_DEPLOY_KEY",
      "VERCEL_ORG_ID",
      "VERCEL_PROJECT_ID",
      "VERCEL_TOKEN",
    ]);
    const byName = Object.fromEntries(
      sets.map((c): [string, string | undefined] => [c.args[2] ?? "", c.input]),
    );
    expect(byName).toEqual({
      CONVEX_DEPLOY_KEY: DEPLOY_KEY,
      VERCEL_TOKEN,
      VERCEL_ORG_ID: "team_1",
      VERCEL_PROJECT_ID: "prj_1",
    });
    for (const c of sets) expect(c.args).toContain("production");
    const everyArg = w.calls.flatMap((c) => c.args).join("\n");
    expect(everyArg).not.toContain(DEPLOY_KEY);
    expect(everyArg).not.toContain(VERCEL_TOKEN);
    expect(everyArg).not.toContain("--body");
    expect(w.logs.join("\n")).not.toContain("SUPERSECRETKEYVALUE");
    expect(w.logs.join("\n")).not.toContain(VERCEL_TOKEN);
  });

  it("skips Convex creation when .env.local already has a cloud deployment", async () => {
    const w = setup({
      files: {
        ".env.local": MATCHING_ENV,
        ".vercel/project.json": PROJECT_JSON,
      },
    });
    expect(await w.exec()).toBe(0);
    expect(w.calls.some((c) => c.args.includes("--configure"))).toBe(false);
    expect(w.calls.some((c) => c.args.includes("token"))).toBe(true);
  });

  it("skips everything when all secrets and the environment exist", async () => {
    const w = setup({
      secrets: [
        "CONVEX_DEPLOY_KEY",
        "VERCEL_TOKEN",
        "VERCEL_ORG_ID",
        "VERCEL_PROJECT_ID",
      ],
      envExists: true,
    });
    expect(await w.exec()).toBe(0);
    expect(w.secretSets()).toEqual([]);
    expect(w.calls.some((c) => c.args.includes("token"))).toBe(false);
    expect(w.calls.some((c) => c.args.includes("link"))).toBe(false);
    expect(w.logs.join("\n")).toMatch(/już istnieją/);
  });

  it("only sets what is missing", async () => {
    const w = setup({
      secrets: ["CONVEX_DEPLOY_KEY", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"],
      envExists: true,
    });
    expect(await w.exec()).toBe(0);
    expect(w.secretSets().map((c) => c.args[2])).toEqual(["VERCEL_TOKEN"]);
  });

  it("creates the ruleset with --protect, as JSON on stdin", async () => {
    const w = setup({ files: { ".vercel/project.json": PROJECT_JSON } }, [
      "--yes",
      "--protect",
    ]);
    expect(await w.exec()).toBe(0);
    const post = w.calls.find((c) => c.args.includes("POST"));
    expect(post?.args).toContain("repos/team/my-hack/rulesets");
    expect(JSON.parse(post?.input ?? "{}")).toEqual(rulesetPayload());
  });

  it("skips the ruleset when it already exists, and only prints the command without --protect", async () => {
    const existing = setup(
      {
        rulesets: [RULESET_NAME],
        files: { ".vercel/project.json": PROJECT_JSON },
      },
      ["--yes", "--protect"],
    );
    await existing.exec();
    expect(existing.calls.some((c) => c.args.includes("POST"))).toBe(false);

    const plain = setup({ files: { ".vercel/project.json": PROJECT_JSON } });
    await plain.exec();
    expect(plain.calls.some((c) => c.args.includes("POST"))).toBe(false);
    expect(plain.logs.join("\n")).toMatch(/setup:deploy -- --protect/);
  });

  it("skips --protect for any active ruleset on main, even one made by hand", async () => {
    const w = setup(
      {
        rulesets: ["my own rules"],
        rulesetRefs: ["~DEFAULT_BRANCH"],
        files: { ".vercel/project.json": PROJECT_JSON },
      },
      ["--yes", "--protect"],
    );
    expect(await w.exec()).toBe(0);
    expect(w.calls.some((c) => c.args.includes("POST"))).toBe(false);

    const other = setup(
      {
        rulesets: ["tags only"],
        rulesetRefs: ["refs/heads/release"],
        files: { ".vercel/project.json": PROJECT_JSON },
      },
      ["--yes", "--protect"],
    );
    await other.exec();
    expect(other.calls.some((c) => c.args.includes("POST"))).toBe(true);
  });

  it("on a fresh repo without the environment treats all secrets as missing and never lists them", async () => {
    const w = setup({ files: { ".vercel/project.json": PROJECT_JSON } });
    expect(await w.exec()).toBe(0);
    expect(
      w.calls.some((c) => c.args[0] === "secret" && c.args[1] === "list"),
    ).toBe(false);
    expect(w.calls.some((c) => c.args.includes("PUT"))).toBe(true);
    expect(w.secretSets()).toHaveLength(4);
    const dry = setup({}, ["--dry-run"]);
    expect(await dry.exec()).toBe(0);
    expect(dry.logs.join(" ")).toMatch(/Brakujące sekrety: CONVEX_DEPLOY_KEY/);
  });

  it("runs the interactive steps with inherited stdio and npx with --yes and the pinned version", async () => {
    const w = setup();
    await w.exec();
    const configure = w.calls.find((c) => c.args.includes("--configure"));
    const link = w.calls.find((c) => c.args.includes("link"));
    expect(configure?.interactive).toBe(true);
    expect(link?.interactive).toBe(true);
    expect(link?.args.slice(0, 2)).toEqual(["--yes", "vercel@65.16.0"]);
    for (const c of w.calls.filter((c) => c.command === "npx"))
      expect(c.args.slice(0, 2)).toEqual(["--yes", "vercel@65.16.0"]);
    const token = w.calls.find((c) => c.args.includes("token"));
    expect(token?.interactive).toBeUndefined();
  });

  it("derives the repo from origin and rejects non-GitHub remotes", async () => {
    expect(parseGithubSlug("git@github.com:team/my-hack.git")).toBe(
      "team/my-hack",
    );
    expect(parseGithubSlug("https://github.com/team/my-hack")).toBe(
      "team/my-hack",
    );
    expect(parseGithubSlug("ssh://git@github.com/team/my-hack.git")).toBe(
      "team/my-hack",
    );
    expect(parseGithubSlug("https://gitlab.com/team/x.git")).toBeNull();
    for (const evil of [
      "https://evilgithub.com/team/x.git",
      "https://github.com.evil.io/team/x.git",
      "https://evil.io/github.com/team/x.git",
      "git@evilgithub.com:team/x.git",
      "git@github.com.evil.io:team/x.git",
      "ssh://git@evilgithub.com/team/x.git",
      "https://github.com@evil.io/team/x.git",
    ])
      expect(parseGithubSlug(evil)).toBeNull();
    const w = setup({ origin: "https://gitlab.com/team/x.git" });
    expect(await w.exec()).toBe(1);
    expect(w.logs.join(" ")).toMatch(/nie wskazuje na repozytorium GitHuba/);
  });

  it("routes a bad project.json and a failed token prompt through the normal error path", async () => {
    const bad1 = setup({ files: { ".vercel/project.json": "{nope" } });
    expect(await bad1.exec()).toBe(1);
    expect(bad1.logs.join(" ")).toMatch(/Błąd: Plik \.vercel\/project\.json/);
  });

  it("treats only an HTTP 404 as a missing environment", async () => {
    for (const argv of [["--yes"], ["--dry-run"]]) {
      for (const err of [
        "gh: Resource not accessible (HTTP 403)",
        "error connecting to api.github.com",
      ]) {
        const w = setup(
          {
            envProbeError: err,
            files: { ".vercel/project.json": PROJECT_JSON },
          },
          argv,
        );
        expect(await w.exec()).toBe(1);
        expect(w.logs.join("\n")).toMatch(/Błąd: Sprawdzenie środowiska/);
        expect(w.logs.join("\n")).toContain(err);
        expect(w.mutations()).toEqual([]);
      }
    }
  });

  it("shows the original token-create error with a hint and never creates a prod deployment", async () => {
    const w = setup({
      tokenError: "getaddrinfo ENOTFOUND api.convex.dev",
      files: { ".vercel/project.json": PROJECT_JSON },
    });
    expect(await w.exec()).toBe(1);
    const out = w.logs.join("\n");
    expect(out).toContain("getaddrinfo ENOTFOUND api.convex.dev");
    expect(out).toContain("npx convex deployment create --type prod --default");
    expect(
      w.calls.some((c) => c.args.join(" ").includes("deployment create")),
    ).toBe(false);
    expect(w.calls.some((c) => c.args.join(" ").includes("secret set"))).toBe(
      false,
    );
  });

  it("creates a missing Vercel project before linking, and only when absent", async () => {
    const w = setup({ vercelProjectExists: false });
    expect(await w.exec()).toBe(0);
    const names = w.calls.map((c) => c.args.join(" "));
    const create = names.findIndex((l) => l.includes("project create my-hack"));
    const link = names.findIndex((l) => l.includes(" link "));
    expect(create).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(create);

    const agent = setup({ vercelProjectExists: false, agentNotFound: true });
    expect(await agent.exec()).toBe(0);
    expect(
      agent.calls.some((c) =>
        c.args.join(" ").includes("project create my-hack"),
      ),
    ).toBe(true);

    for (const inspectError of [
      "Error: fetch failed (ECONNRESET)",
      '{\n  "status": "error",\n  "reason": "login_required"\n}',
      "Error: Its team was not found.",
    ]) {
      const aborted = setup({ inspectError });
      expect(await aborted.exec()).toBe(1);
      expect(
        aborted.calls.some((c) => c.args.join(" ").includes("project create")),
      ).toBe(false);
    }

    const present = setup();
    await present.exec();
    expect(
      present.calls.some((c) => c.args.join(" ").includes("project create")),
    ).toBe(false);

    const broken = setup({ inspectError: "Error: fetch failed (ECONNRESET)" });
    expect(await broken.exec()).toBe(1);
    expect(broken.logs.join("\n")).toContain("ECONNRESET");
    expect(
      broken.calls.some((c) => c.args.join(" ").includes("project create")),
    ).toBe(false);

    const dry = setup({ vercelProjectExists: false }, ["--dry-run"]);
    expect(await dry.exec()).toBe(0);
    expect(dry.mutations()).toEqual([]);
    expect(dry.logs.join("\n")).toMatch(/\[dry-run\] Vercel: tworzę projekt/);
  });

  it("re-links when .vercel/project.json points at another project", async () => {
    const stale = setup({
      vercelProjectId: "prj_other",
      files: { ".vercel/project.json": PROJECT_JSON },
    });
    expect(await stale.exec()).toBe(0);
    expect(stale.calls.some((c) => c.args.includes("link"))).toBe(true);
    expect(stale.logs.join("\n")).toMatch(/nie pasuje do projektu/);

    const match = setup({ files: { ".vercel/project.json": PROJECT_JSON } });
    await match.exec();
    expect(match.calls.some((c) => c.args.includes("link"))).toBe(false);

    const dry = setup(
      {
        vercelProjectId: "prj_other",
        files: { ".vercel/project.json": PROJECT_JSON },
      },
      ["--dry-run"],
    );
    await dry.exec();
    expect(dry.mutations()).toEqual([]);
    expect(dry.logs.join("\n")).toMatch(/\[dry-run\] Vercel: .*nie pasuje/);
  });

  it("scrubs secrets from errors", async () => {
    const w = setup({
      files: { ".vercel/project.json": PROJECT_JSON },
      failSecretSet: true,
    });
    expect(await w.exec()).toBe(1);
    const out = w.logs.join("\n");
    expect(out).toMatch(/Błąd:/);
    expect(out).toContain("***");
    expect(out).not.toContain("SUPERSECRETKEYVALUE");
  });

  it("rejects a deploy key that is not a production key, without echoing it", async () => {
    const w = setup({ keyOutput: "dev:some-dev|DEVSECRETVALUE" });
    expect(await w.exec()).toBe(1);
    expect(w.logs.join("\n")).toMatch(/nieoczekiwanym formacie/);
    expect(w.logs.join("\n")).not.toContain("DEVSECRETVALUE");
    expect(w.secretSets()).toEqual([]);
  });
});
