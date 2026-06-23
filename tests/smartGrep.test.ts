import {
  createRegex,
  formatResults,
  isBinaryFile,
} from "../src/tools/smartGrep.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ============================================================
// SMART GREP — Unit Tests
// ============================================================

describe("createRegex", () => {
  test("creates case-insensitive regex from plain text", () => {
    const regex = createRegex("hello world");
    expect(regex.test("Hello World")).toBe(true);
    expect(regex.test("HELLO WORLD")).toBe(true);
    expect(regex.test("goodbye")).toBe(false);
  });

  test("supports regex patterns with special chars", () => {
    const regex = createRegex("function\\s+\\w+");
    expect(regex.test("function foo()")).toBe(true);
    expect(regex.test("function bar()")).toBe(true);
    expect(regex.test("not a function")).toBe(false);
  });

  test("handles regex with quantifiers", () => {
    const regex = createRegex("\\d{3,}");
    expect(regex.test("abc12345def")).toBe(true);
    expect(regex.test("abc12def")).toBe(false);
  });

  test("uses dot as wildcard in regex mode", () => {
    // "foo.bar" has special char '.' so it's used as regex
    const regex = createRegex("foo.bar");
    expect(regex.test("foo.bar")).toBe(true);
    // '.' matches any char in regex mode
    expect(regex.test("fooXbar")).toBe(true);
  });

  test("falls back to literal search when regex invalid", () => {
    // Invalid regex pattern triggers fallback to literal escape
    const regex = createRegex("(unclosed group");
    expect(regex.test("(unclosed group")).toBe(true);
    // After escaping: \(unclosed group\) - matches literally
    expect(regex.test("unclosed group")).toBe(false);
  });

  test("handles anchors", () => {
    const regex = createRegex("^function");
    expect(regex.test("function foo()")).toBe(true);
    expect(regex.test("  function foo()")).toBe(false);
  });

  test("handles alternation", () => {
    const regex = createRegex("error|warning");
    expect(regex.test("This is an error")).toBe(true);
    expect(regex.test("This is a warning")).toBe(true);
    expect(regex.test("This is info")).toBe(false);
  });

  test("empty pattern matches anything", () => {
    const regex = createRegex("");
    expect(regex.test("anything")).toBe(true);
  });
});

describe("formatResults", () => {
  const sampleResults = [
    { file: "src/auth.ts", line: 42, content: "42: function login() {\n43:   return token;\n44: }" },
    { file: "src/middleware.ts", line: 15, content: "15: function auth() {\n16:   return true;\n17: }" },
  ];

  test("returns no results message when empty", () => {
    const output = formatResults([], "test", 10);
    expect(output).toContain("Tidak ada hasil");
    expect(output).toContain("test");
    expect(output).toContain("10 file discan");
  });

  test("includes query in output", () => {
    const output = formatResults(sampleResults, "login", 20);
    expect(output).toContain('"login"');
  });

  test("includes file paths in results", () => {
    const output = formatResults(sampleResults, "auth", 5);
    expect(output).toContain("src/auth.ts");
    expect(output).toContain("src/middleware.ts");
  });

  test("includes line numbers", () => {
    const output = formatResults(sampleResults, "auth", 5);
    expect(output).toContain(":42");
    expect(output).toContain(":15");
  });

  test("includes context lines", () => {
    const output = formatResults(sampleResults, "auth", 5);
    expect(output).toContain("function login()");
    expect(output).toContain("function auth()");
  });

  test("counts results correctly", () => {
    const output = formatResults(sampleResults, "auth", 5);
    expect(output).toContain("2 hasil");
  });

  test("single result still works", () => {
    const single = [{ file: "src/foo.ts", line: 1, content: "1: hello\n2: world" }];
    const output = formatResults(single, "hello", 10);
    expect(output).toContain("1 hasil");
    expect(output).toContain("src/foo.ts");
  });
});

describe("isBinaryFile", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartgrep-test-"));

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns false for text file", () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "Hello, this is a text file!", "utf-8");
    expect(isBinaryFile(filePath)).toBe(false);
  });

  test("returns true for file with null bytes", () => {
    const filePath = path.join(tmpDir, "binary.bin");
    const buf = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6c, 0x6f]);
    fs.writeFileSync(filePath, buf);
    expect(isBinaryFile(filePath)).toBe(true);
  });

  test("returns true for non-existent file", () => {
    expect(isBinaryFile("/nonexistent/file.bin")).toBe(true);
  });
});

// ============================================================
// INTEGRATION: handleSmartGrep via temp project
// ============================================================
describe("handleSmartGrep integration", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smartgrep-integration-"));
  let origRoot: string | undefined;

  beforeAll(() => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });

    fs.writeFileSync(path.join(tmpDir, "src", "auth.ts"), `
function authenticate(username: string, password: string): boolean {
  return username === "admin" && password === "secret";
}
function logout(): void {
  console.log("User logged out");
}
`, "utf-8");

    fs.writeFileSync(path.join(tmpDir, "src", "utils.ts"), `
function hashPassword(password: string): string {
  return password.split("").reverse().join("");
}
`, "utf-8");

    fs.writeFileSync(path.join(tmpDir, "node_modules", "some-lib.js"), `
// Should not appear in results
function authenticate() {}
`, "utf-8");

    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      name: "test-project",
      version: "1.0.0",
    }), "utf-8");
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

  test("finds authenticate function in source files", async () => {
    const { handleSmartGrep } = await import("../src/tools/smartGrep.js");
    const result = await handleSmartGrep({ query: "authenticate", maxResults: 10 });

    expect(result).toContain("authenticate");
    expect(result).toContain("src/auth.ts");
    expect(result).not.toContain("node_modules");
  });

  test("returns no results for non-existent pattern", async () => {
    const { handleSmartGrep } = await import("../src/tools/smartGrep.js");
    const result = await handleSmartGrep({ query: "zzz_nonexistent_zzz" });

    expect(result).toContain("Tidak ada hasil");
  });

  test("handles empty query", async () => {
    const { handleSmartGrep } = await import("../src/tools/smartGrep.js");
    const result = await handleSmartGrep({ query: "" });
    expect(result).toContain("wajib diisi");
  });

  test("maxResults limits output", async () => {
    const { handleSmartGrep } = await import("../src/tools/smartGrep.js");
    const result = await handleSmartGrep({ query: "function", maxResults: 1 });

    const matchCount = (result.match(/📄/g) || []).length;
    expect(matchCount).toBeLessThanOrEqual(1);
  });

  test("filters results by extension", async () => {
    const { handleSmartGrep } = await import("../src/tools/smartGrep.js");
    const result = await handleSmartGrep({ query: "function", extensions: ["ts"] });
    expect(result).toContain("src/auth.ts");
    expect(result).not.toContain("package.json");
  });
});

