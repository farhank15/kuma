import { handleSmartFilePicker } from "../src/tools/smartFilePicker.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("handleSmartFilePicker — path resolution", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-path-"));
  let origRoot: string | undefined;
  let origCwd: string | undefined;

  beforeAll(() => {
    fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "root" }), "utf-8");
    fs.writeFileSync(path.join(tmpDir, "sub", "package.json"), JSON.stringify({ name: "sub" }), "utf-8");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    origRoot = process.env.AGENT_PROJECT_ROOT;
    origCwd = process.cwd();
    process.env.AGENT_PROJECT_ROOT = tmpDir;
  });

  afterEach(() => {
    process.env.AGENT_PROJECT_ROOT = origRoot;
    if (origCwd) process.chdir(origCwd);
  });

  test("reads file from project root by default", async () => {
    const result = await handleSmartFilePicker({ filePath: "package.json", chunkStrategy: "full" });
    expect(result).toContain("package.json");
    expect(result).toContain('"root"');
  });

  test("reads file from CWD subdirectory first", async () => {
    process.chdir(path.join(tmpDir, "sub"));
    const result = await handleSmartFilePicker({ filePath: "package.json", chunkStrategy: "full" });
    expect(result).toContain("package.json");
    expect(result).toContain('"sub"');
  });

  test("absolute path works directly", async () => {
    const absPath = path.join(tmpDir, "package.json");
    const result = await handleSmartFilePicker({ filePath: absPath, chunkStrategy: "full" });
    expect(result).toContain("package.json");
    expect(result).toContain('"root"');
  });

  test("returns error for non-existent file", async () => {
    const result = await handleSmartFilePicker({ filePath: "nonexistent.ts" });
    expect(result).toContain("Error");
    expect(result).toContain("tidak ditemukan");
  });

  test("returns error for path traversal", async () => {
    const result = await handleSmartFilePicker({ filePath: "../etc/passwd" });
    expect(result).toContain("Error");
  });

  test("returns error for blocked system directory", async () => {
    const result = await handleSmartFilePicker({ filePath: "/etc/passwd" });
    expect(result).toContain("Error");
  });
});

describe("handleSmartFilePicker — chunk strategies", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfp-chunk-"));
  let origRoot: string | undefined;

  beforeAll(() => {
    const lines: string[] = [];
    for (let i = 1; i <= 500; i++) {
      if (i <= 15) {
        lines.push(`import { something${i} } from "module${i}";`);
      } else {
        lines.push(`export function handler${i}(): void {}`);
      }
    }
    fs.writeFileSync(path.join(tmpDir, "large.ts"), lines.join("\n"), "utf-8");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    origRoot = process.env.AGENT_PROJECT_ROOT;
    process.env.AGENT_PROJECT_ROOT = tmpDir;
  });

  afterEach(() => {
    process.env.AGENT_PROJECT_ROOT = origRoot;
  });

  test("full strategy reads entire file", async () => {
    const result = await handleSmartFilePicker({ filePath: "large.ts", chunkStrategy: "full" });
    expect(result).toContain("500 baris total");
    expect(result).toContain("handler50");
  });

  test("outline strategy shows only imports and declarations", async () => {
    const result = await handleSmartFilePicker({ filePath: "large.ts", chunkStrategy: "outline" });
    expect(result).toContain("OUTLINE MODE");
    expect(result).toContain("[L16]");
    expect(result).toContain("handler50");
  });

  test("smart strategy shows header + declarations + tail", async () => {
    const result = await handleSmartFilePicker({ filePath: "large.ts", chunkStrategy: "smart" });
    expect(result).toContain("SMART MODE");
    expect(result).toContain("something1");
  });

  test("startLine/endLine reads range correctly", async () => {
    const result = await handleSmartFilePicker({
      filePath: "large.ts",
      startLine: 5,
      endLine: 10,
    });
    expect(result).toContain("something5");
    expect(result).toContain("something10");
    expect(result).toContain("large.ts");
  });

  test("default strategy for files under threshold returns full", async () => {
    fs.writeFileSync(path.join(tmpDir, "small.ts"), "const x = 1;\nconst y = 2;\n", "utf-8");
    const result = await handleSmartFilePicker({ filePath: "small.ts" });
    expect(result).toContain("const x = 1");
    expect(result).toContain("const y = 2");
  });
});
