import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGenerated } from "./lib/codegen-check.mjs";

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "codegen-test-"));
  dir = join(root, "_generated");
  mkdirSync(dir);
  writeFileSync(join(dir, "api.js"), "api\n");
  writeFileSync(join(dir, "server.js"), "server\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const read = (name: string) => readFileSync(join(dir, name));

describe("checkGenerated", () => {
  it("is fresh when codegen changes nothing", () => {
    expect(checkGenerated({ dir, runCodegen: () => 0 })).toEqual({
      status: "fresh",
    });
  });

  it("treats a CRLF-only difference as fresh", () => {
    const result = checkGenerated({
      dir,
      runCodegen: () => {
        writeFileSync(join(dir, "api.js"), "api\r\n");
        return 0;
      },
    });
    expect(result.status).toBe("fresh");
  });

  it("reports changed, added and removed files and restores the originals", () => {
    const result = checkGenerated({
      dir,
      runCodegen: () => {
        writeFileSync(join(dir, "api.js"), "changed\n");
        writeFileSync(join(dir, "new.js"), "new\n");
        rmSync(join(dir, "server.js"));
        return 0;
      },
    });
    expect(result).toEqual({
      status: "stale",
      changed: ["api.js", "new.js", "server.js"],
    });
    expect(read("api.js")).toEqual(Buffer.from("api\n"));
    expect(read("server.js")).toEqual(Buffer.from("server\n"));
    expect(() => read("new.js")).toThrow();
  });

  it("restores the original bytes when stale", () => {
    writeFileSync(join(dir, "api.js"), "api\r\nline\r\n");
    checkGenerated({
      dir,
      runCodegen: () => {
        writeFileSync(join(dir, "api.js"), "other\n");
        return 0;
      },
    });
    expect(read("api.js")).toEqual(Buffer.from("api\r\nline\r\n"));
  });

  it("fails and restores when codegen exits non-zero after a partial write", () => {
    const result = checkGenerated({
      dir,
      runCodegen: () => {
        writeFileSync(join(dir, "api.js"), "partial\n");
        return 1;
      },
    });
    expect(result).toEqual({ status: "failed" });
    expect(read("api.js")).toEqual(Buffer.from("api\n"));
  });
});
