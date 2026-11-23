import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const require = createRequire(path.join(root, "package.json"));
const tsc = require.resolve("typescript/bin/tsc");

const result = spawnSync(process.execPath, [tsc, "-b", "--pretty", "false"], {
  cwd: root,
  encoding: "utf8",
});

if (result.error) {
  process.stderr.write(
    `typecheck hook could not start tsc: ${result.error.message}\n`,
  );
  process.exit(2);
}

if (result.status !== 0) {
  process.stderr.write(result.stdout + result.stderr);
  process.exit(2);
}
