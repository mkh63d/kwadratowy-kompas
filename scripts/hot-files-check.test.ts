import { describe, expect, it } from "vitest";
import {
  ACK_TEXT,
  diffArgs,
  evaluate,
  isAcknowledged,
} from "./hot-files-check.mjs";
import { classify, loadHotFiles } from "./lib/hot-files.mjs";

const patterns = loadHotFiles(".github/hot-files.txt");
const ticked = `Intro\n\n- [x] ${ACK_TEXT}\n`;
const unticked = `- [ ] ${ACK_TEXT}\n`;

describe("hot-files-check", () => {
  it("passes a PR with only hot files", () => {
    const r = evaluate({
      files: ["package.json", "src/lib/utils.ts"],
      body: "",
      patterns,
    });
    expect(r.ok).toBe(true);
  });

  it("passes a PR with only feature files", () => {
    const r = evaluate({
      files: ["src/features/notes/List.tsx", "convex/notes/queries.ts"],
      body: "",
      patterns,
    });
    expect(r.ok).toBe(true);
  });

  it("fails a mixed PR without acknowledgement and lists both groups", () => {
    const r = evaluate({
      files: ["package.json", "src/features/notes/List.tsx"],
      body: unticked,
      patterns,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("package.json");
    expect(r.message).toContain("src/features/notes/List.tsx");
  });

  it("passes a mixed PR with the box ticked", () => {
    const r = evaluate({
      files: ["package.json", "src/features/notes/List.tsx"],
      body: ticked,
      patterns,
    });
    expect(r.ok).toBe(true);
  });

  it("passes a contract PR: tables, schema, generated files and its test", () => {
    const r = evaluate({
      files: [
        "convex/notes/tables.ts",
        "convex/schema.ts",
        "convex/_generated/api.d.ts",
        "convex/_generated/dataModel.d.ts",
        "convex/notes/tables.test.ts",
        "convex/schema.test.ts",
      ],
      body: "",
      patterns,
    });
    expect(r.ok).toBe(true);
  });

  it("treats generated files alone as neither hot nor normal", () => {
    const r = evaluate({
      files: ["package.json", "convex/_generated/api.d.ts"],
      body: "",
      patterns,
    });
    expect(r.ok).toBe(true);
    expect(r.normal).toEqual([]);
  });

  it("counts a hot file renamed into a feature folder as mixed", () => {
    expect(diffArgs("a", "b")).toContain("--no-renames");
    const r = evaluate({
      files: ["src/lib/util.ts", "src/features/x/util.ts"],
      body: "",
      patterns,
    });
    expect(r.ok).toBe(false);
  });

  it("ignores a ticked line inside an HTML comment or a code fence", () => {
    expect(isAcknowledged(`<!--\n- [x] ${ACK_TEXT}\n-->`)).toBe(false);
    expect(isAcknowledged(`\`\`\`md\n- [x] ${ACK_TEXT}\n\`\`\``)).toBe(false);
    expect(isAcknowledged(`~~~\n- [x] ${ACK_TEXT}\n~~~`)).toBe(false);
    expect(isAcknowledged(`<!-- hint -->\n- [x] ${ACK_TEXT}`)).toBe(true);
    expect(isAcknowledged(`\`\`\`\ncode\n\`\`\`\n- [x] ${ACK_TEXT}`)).toBe(
      true,
    );
  });

  it("treats the checker and its list as hot files", () => {
    for (const file of [
      "scripts/hot-files-check.mjs",
      "scripts/lib/hot-files.mjs",
    ])
      expect(classify(file, patterns)).toBe("hot");
  });

  it("accepts CRLF bodies and * bullets, rejects other text", () => {
    expect(isAcknowledged(`x\r\n* [X] ${ACK_TEXT}\r\n`)).toBe(true);
    expect(isAcknowledged(unticked)).toBe(false);
    expect(isAcknowledged(`- [x] ${ACK_TEXT} (maybe)`)).toBe(false);
    expect(isAcknowledged("")).toBe(false);
  });
});
