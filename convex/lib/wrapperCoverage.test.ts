import {
  actionGeneric,
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

// Mirrors the Convex bundler's entry points: files with more than one dot (tests, .d.ts) are not deployed.
// Root-anchored, because a relative glob keys the importer's own directory as "./".
const deployedModules: ModuleMap = import.meta.glob<Record<string, unknown>>([
  "/convex/**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}",
  "!/convex/_generated/**",
  "!/convex/**/*.*.*",
]);

function functionName(modulePath: string, exportName: string): string {
  const moduleName = modulePath
    .replace(/^\/convex\//, "")
    .replace(/\.[^.]+$/, "")
    .replaceAll("/", ".");
  return `${moduleName}.${exportName}`;
}

function isPublicFunction(value: unknown): boolean {
  return (
    typeof value === "function" &&
    (value as { isPublic?: unknown }).isPublic === true
  );
}

async function scanPublicFunctions(modules: ModuleMap) {
  const publicNames: string[] = [];
  const unwrapped: string[] = [];
  for (const [path, load] of Object.entries(modules)) {
    for (const [exportName, value] of Object.entries(await load())) {
      if (!isPublicFunction(value)) continue;
      const name = functionName(path, exportName);
      publicNames.push(name);
      if (!isWrapped(value) && !ALLOWLIST.has(name)) unwrapped.push(name);
    }
  }
  return { publicNames, unwrapped };
}

describe("wrapper coverage (spec §5.3)", () => {
  it("every public function in a deployed module is wrapper output", async () => {
    const { unwrapped } = await scanPublicFunctions(deployedModules);
    expect(unwrapped).toStrictEqual([]);
  });

  it("scans the real modules, test files excluded", async () => {
    const { publicNames } = await scanPublicFunctions(deployedModules);
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

    const { unwrapped } = await scanPublicFunctions(modules);

    expect(unwrapped).toStrictEqual([
      "feature.raw.rawQuery",
      "feature.raw.rawMutation",
      "feature.raw.rawAction",
      "auth.store",
    ]);
  });
});
