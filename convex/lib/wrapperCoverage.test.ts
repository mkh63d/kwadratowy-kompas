import {
  actionGeneric,
  httpActionGeneric,
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { describe, expect, it } from "vitest";
import { isWrapped, publicQuery } from "./functions";

type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;

const ALLOWLIST: ReadonlySet<string> = new Set([
  "auth.signIn",
  "auth.signOut",
  "auth.isAuthenticated",
  "http.default",
]);

const HTTP_MODULE = /^(http|[^/]+\/httpHandler)$/;

// Like the Convex bundler, skips _generated and files with more than one dot (tests, .d.ts).
// Root-anchored, because a relative glob keys the importer's own directory as "./".
const deployedModules: ModuleMap = import.meta.glob<Record<string, unknown>>([
  "/convex/**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}",
  "!/convex/_generated/**",
  "!/convex/**/*.*.*",
]);

function modulePathOf(path: string): string {
  return path.replace(/^\/convex\//, "").replace(/\.[^.]+$/, "");
}

function hasFlag(value: unknown, flag: "isPublic" | "isHttp"): boolean {
  return typeof value === "function" && Reflect.get(value, flag) === true;
}

async function scanModules(modules: ModuleMap) {
  const publicNames: string[] = [];
  const unwrapped: string[] = [];
  const misplacedHttp: string[] = [];
  for (const [path, load] of Object.entries(modules)) {
    const modulePath = modulePathOf(path);
    for (const [exportName, value] of Object.entries(await load())) {
      const name = `${modulePath.replaceAll("/", ".")}.${exportName}`;
      if (hasFlag(value, "isHttp") && !HTTP_MODULE.test(modulePath)) {
        misplacedHttp.push(name);
      }
      if (!hasFlag(value, "isPublic")) continue;
      publicNames.push(name);
      if (!isWrapped(value) && !ALLOWLIST.has(name)) unwrapped.push(name);
    }
  }
  return { publicNames, unwrapped, misplacedHttp };
}

describe("wrapper coverage (spec §5.3)", () => {
  it("every public function in a deployed module is wrapper output", async () => {
    const { unwrapped } = await scanModules(deployedModules);
    expect(unwrapped).toStrictEqual([]);
  });

  it("HTTP actions live only in convex/http.ts and convex/*/httpHandler.ts", async () => {
    const { misplacedHttp } = await scanModules(deployedModules);
    expect(misplacedHttp).toStrictEqual([]);
  });

  it("scans the real modules, test files excluded", async () => {
    const { publicNames } = await scanModules(deployedModules);
    expect(publicNames).toContain("health.queries.ping");
    const paths = Object.keys(deployedModules);
    expect(paths).toContain("/convex/lib/functions.ts");
    expect(paths.filter((path) => path.includes(".test."))).toStrictEqual([]);
  });

  it("flags raw public builders and skips internal, wrapped and allowlisted ones", async () => {
    const definition = { args: {}, handler: () => null };
    const modules: ModuleMap = {
      "/convex/feature/raw.ts": () =>
        Promise.resolve({
          rawQuery: queryGeneric(definition),
          rawMutation: mutationGeneric(definition),
          rawAction: actionGeneric(definition),
          internalQuery: internalQueryGeneric(definition),
          internalMutation: internalMutationGeneric(definition),
          internalAction: internalActionGeneric(definition),
          wrapped: publicQuery(definition),
          notAFunction: { isPublic: true },
        }),
      "/convex/auth.ts": () =>
        Promise.resolve({
          signIn: actionGeneric(definition),
          store: queryGeneric(definition),
        }),
    };

    const { unwrapped } = await scanModules(modules);

    expect(unwrapped).toStrictEqual([
      "feature.raw.rawQuery",
      "feature.raw.rawMutation",
      "feature.raw.rawAction",
      "auth.store",
    ]);
  });

  it("flags HTTP actions outside http.ts and one-level httpHandler.ts", async () => {
    const httpAction = () =>
      httpActionGeneric(() => Promise.resolve(new Response()));
    const modules: ModuleMap = {
      "/convex/http.ts": () => Promise.resolve({ hook: httpAction() }),
      "/convex/ingest/httpHandler.ts": () =>
        Promise.resolve({ handler: httpAction() }),
      "/convex/feature/raw.ts": () =>
        Promise.resolve({ hook: httpAction(), notAFunction: { isHttp: true } }),
      "/convex/httpHandler.ts": () => Promise.resolve({ hook: httpAction() }),
      "/convex/a/b/httpHandler.ts": () =>
        Promise.resolve({ hook: httpAction() }),
      "/convex/feature/http.ts": () => Promise.resolve({ hook: httpAction() }),
    };

    const { misplacedHttp } = await scanModules(modules);

    expect(misplacedHttp).toStrictEqual([
      "feature.raw.hook",
      "httpHandler.hook",
      "a.b.httpHandler.hook",
      "feature.http.hook",
    ]);
  });
});
