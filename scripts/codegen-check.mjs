// Fails when `convex/_generated` is out of date. Needs a Convex deployment
// (`convex codegen` refuses to run without one), so it is a local/lane check, not a CI one.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkGenerated } from "./lib/codegen-check.mjs";
import { CONVEX_BIN } from "./lib/proc.mjs";

const result = checkGenerated({
  dir: join("convex", "_generated"),
  runCodegen: () =>
    spawnSync(process.execPath, [CONVEX_BIN, "codegen"], {
      stdio: ["ignore", "inherit", "inherit"],
      // anonymous mode lets a clone with a local backend run without a login
      env: { CONVEX_AGENT_MODE: "anonymous", ...process.env },
    }).status ?? 1,
});

if (result.status === "failed") {
  console.error(
    "\ncodegen:check could not run `convex codegen` (see output above).\n" +
      "It needs a configured Convex deployment: run `npx convex dev --once` once to set one up.",
  );
  process.exit(2);
}

if (result.status === "stale") {
  console.error(
    `\nconvex/_generated is stale. Differing files:\n${result.changed.map((f) => `  - ${f}`).join("\n")}\n` +
      "Run `npx convex codegen` and commit the result.",
  );
  process.exit(1);
}

console.log("convex/_generated is up to date.");
