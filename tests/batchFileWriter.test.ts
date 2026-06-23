import { handleBatchFileWriter } from "../src/tools/batchFileWriter.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("handleBatchFileWriter — validation", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bfw-"));
  let origRoot: string | undefined;

  beforeAll(() => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
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

  test("creates new file successfully", async () => {
    const result = await handleBatchFileWriter({
      files: [{ filePath: "src/new.ts", content: "export const x = 1;", instructions: "test" }],
    });
    expect(result).toContain("berhasil dibuat");
    expect(fs.existsSync(path.join(tmpDir, "src", "new.ts"))).toBe(true);
    const content = fs.readFileSync(path.join(tmpDir, "src", "new.ts"), "utf-8");
    expect(content).toBe("export const x = 1;");
  });

  test("creates multiple files", async () => {
    const result = await handleBatchFileWriter({
      files: [
        { filePath: "src/a.ts", content: "const a = 1;", instructions: "test" },
        { filePath: "src/b.ts", content: "const b = 2;", instructions: "test" },
      ],
    });
    expect(result).toContain("2 file");
    expect(fs.existsSync(path.join(tmpDir, "src", "a.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "src", "b.ts"))).toBe(true);
  });

  test("rejects unsupported file extension", async () => {
    const result = await handleBatchFileWriter({
      files: [{ filePath: "src/bad.exe", content: "MZ...", instructions: "test" }],
    });
    expect(result).toContain("❌");
    expect(result).toContain("Ekstensi");
  });

  test("rejects path traversal", async () => {
    const result = await handleBatchFileWriter({
      files: [{ filePath: "../escape.ts", content: "export const x = 1;", instructions: "test" }],
    });
    expect(result).toContain("❌");
    expect(result).toContain("PATH_TRAVERSAL");
  });

  test("rejects system directory access", async () => {
    const result = await handleBatchFileWriter({
      files: [{ filePath: "/etc/evil.ts", content: "export const x = 1;", instructions: "test" }],
    });
    expect(result).toContain("❌");
    expect(result).toContain("Access denied");
  });

  test("rejects empty content", async () => {
    const result = await handleBatchFileWriter({
      files: [{ filePath: "src/empty.ts", content: "", instructions: "test" }],
    });
    expect(result).toContain("❌");
    expect(result).toContain("Konten");
  });

  test("rejects file without instructions", async () => {
    const result = await handleBatchFileWriter({
      files: [{ filePath: "src/noinst.ts", content: "export const x = 1;", instructions: "" }],
    });
    expect(result).toContain("❌");
    expect(result).toContain("wajib diisi");
  });

  test("rejects more than 15 files", async () => {
    const files = Array.from({ length: 16 }, (_, i) => ({
      filePath: `src/file${i}.ts`,
      content: `const x${i} = ${i};`,
      instructions: "test",
    }));
    const result = await handleBatchFileWriter({ files });
    expect(result).toContain("Error");
    expect(result).toContain("15");
  });

  test("allows JSON files", async () => {
    const result = await handleBatchFileWriter({
      files: [{ filePath: "config.json", content: JSON.stringify({ key: "value" }), instructions: "test" }],
    });
    expect(result).toContain("berhasil");
    expect(fs.existsSync(path.join(tmpDir, "config.json"))).toBe(true);
  });

  test("creates intermediate directories", async () => {
    const result = await handleBatchFileWriter({
      files: [{ filePath: "deep/nested/dir/file.ts", content: "export const deep = true;", instructions: "test" }],
    });
    expect(result).toContain("berhasil");
    expect(fs.existsSync(path.join(tmpDir, "deep", "nested", "dir", "file.ts"))).toBe(true);
  });
});
