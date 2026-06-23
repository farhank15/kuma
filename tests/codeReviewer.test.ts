import { jest } from "@jest/globals";
import { handleCodeReviewer } from "../src/agents/codeReviewer.js";
import fs from "node:fs";

describe("codeReviewer", () => {
  beforeEach(() => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readFileSync").mockReturnValue(`
      console.log("hello");
      const x: any = 123;
      eval("alert('test')");
    `);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns text formatted review comments", async () => {
    const result = await handleCodeReviewer({
      files: ["src/index.ts"],
      focus: "correctness",
    });

    expect(result).toContain("Code Review");
    expect(result).toContain("console.log");
    expect(result).toContain("'any' type");
  });

  test("returns JSON formatted review comments", async () => {
    const result = await handleCodeReviewer({
      files: ["src/index.ts"],
      focus: "correctness",
      format: "json",
    });

    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].file).toBe("src/index.ts");
    expect(parsed[0].severity).toBeDefined();
    expect(parsed[0].message).toBeDefined();
  });
});
