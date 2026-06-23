import { jest } from "@jest/globals";
import {
  handleFindReferences,
  handleGoToDefinition,
  handleRenameSymbol,
  handleGetTypeInfo,
  handleLspQuery,
} from "../src/tools/lspTools.js";
import { lspClient } from "../src/engine/lspClient.js";
import fs from "node:fs";

// ============================================================
// LSP TOOLS — Unit Tests
// ============================================================

beforeEach(() => {
  // Mock fs.existsSync to return true by default
  jest.spyOn(fs, "existsSync").mockReturnValue(true);
  // Mock fs.readFileSync to return basic content
  jest.spyOn(fs, "readFileSync").mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.endsWith("test.ts")) {
      return "function hello() {\\n  return 1;\\n}\\n\\nconst x = hello();\\n";
    }
    return "const y = 42;\\n";
  });
  // Mock fs.writeFileSync
  jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("handleFindReferences", () => {
  test("returns formatted references", async () => {
    jest.spyOn(lspClient, "findReferences").mockResolvedValue([
      { filePath: "/project/src/test.ts", line: 0, character: 9, lineContent: "" },
      { filePath: "/project/src/test.ts", line: 3, character: 6, lineContent: "" },
    ]);

    const result = await handleFindReferences({
      filePath: "src/test.ts",
      line: 0,
      character: 9,
    });

    expect(result).toContain("Find References");
    expect(result).toContain("2 referensi");
    expect(result).toContain("test.ts");
  });

  test("returns empty message when no references found", async () => {
    jest.spyOn(lspClient, "findReferences").mockResolvedValue([]);

    const result = await handleFindReferences({
      filePath: "src/test.ts",
      line: 0,
      character: 0,
    });

    expect(result).toContain("Tidak ada referensi");
  });

  test("handles invalid file path", async () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(false);

    const result = await handleFindReferences({
      filePath: "nonexistent.ts",
      line: 0,
      character: 0,
    });

    expect(result).toContain("Error");
  });
});

describe("handleGoToDefinition", () => {
  test("returns definition location", async () => {
    jest.spyOn(lspClient, "goToDefinition").mockResolvedValue({
      uri: "file:///project/src/defs.ts",
      filePath: "/project/src/defs.ts",
      line: 10,
      character: 4,
    });

    const result = await handleGoToDefinition({
      filePath: "src/test.ts",
      line: 3,
      character: 6,
    });

    expect(result).toContain("Go to Definition");
    expect(result).toContain("defs.ts");
    expect(result).toContain("Line: 11:5"); // 0-indexed → 1-indexed +1
  });

  test("handles null definition", async () => {
    jest.spyOn(lspClient, "goToDefinition").mockResolvedValue(null);

    const result = await handleGoToDefinition({
      filePath: "src/test.ts",
      line: 0,
      character: 0,
    });

    expect(result).toContain("Tidak dapat menemukan definisi");
  });
});

describe("handleRenameSymbol", () => {
  test("applies rename changes successfully", async () => {
    jest.spyOn(lspClient, "renameSymbol").mockResolvedValue({
      success: true,
      changes: [
        {
          filePath: "/project/src/test.ts",
          edits: [
            { line: 0, character: 9, endLine: 0, endCharacter: 14, newText: "greeting" },
          ],
        },
        {
          filePath: "/project/src/other.ts",
          edits: [
            { line: 0, character: 6, endLine: 0, endCharacter: 11, newText: "greeting" },
          ],
        },
      ],
    });

    const result = await handleRenameSymbol({
      filePath: "src/test.ts",
      line: 0,
      character: 9,
      newName: "greeting",
    });

    expect(result).toContain("Rename Symbol");
    expect(result).toContain("✅");
    expect(result).toContain("2 perubahan");
    expect(result).toContain("other.ts");
    expect(result).toContain("test.ts");
  });

  test("handles empty newName", async () => {
    const result = await handleRenameSymbol({
      filePath: "src/test.ts",
      line: 0,
      character: 0,
      newName: "",
    });

    expect(result).toContain("Error");
    expect(result).toContain("newName");
  });

  test("handles rename failure", async () => {
    jest.spyOn(lspClient, "renameSymbol").mockResolvedValue({
      success: false,
      changes: [],
      error: "Symbol not renomable",
    });

    const result = await handleRenameSymbol({
      filePath: "src/test.ts",
      line: 0,
      character: 9,
      newName: "newName",
    });

    expect(result).toContain("gagal");
    expect(result).toContain("Symbol not renomable");
  });
});

describe("handleGetTypeInfo", () => {
  test("returns type information", async () => {
    jest.spyOn(lspClient, "getTypeInfo").mockResolvedValue({
      contents: "const x: number",
      range: { start: { line: 0, character: 6 }, end: { line: 0, character: 7 } },
    });

    const result = await handleGetTypeInfo({
      filePath: "src/test.ts",
      line: 0,
      character: 6,
    });

    expect(result).toContain("Type Info");
    expect(result).toContain("const x: number");
    expect(result).toContain("Cakupan");
  });

  test("handles null hover result", async () => {
    jest.spyOn(lspClient, "getTypeInfo").mockResolvedValue(null);

    const result = await handleGetTypeInfo({
      filePath: "src/test.ts",
      line: 0,
      character: 0,
    });

  });
});

describe("handleLspQuery", () => {
  test("wraps goToDefinition, findReferences, and getTypeInfo correctly", async () => {
    jest.spyOn(lspClient, "goToDefinition").mockResolvedValue({
      uri: "file:///project/src/defs.ts",
      filePath: "/project/src/defs.ts",
      line: 10,
      character: 4,
    });
    jest.spyOn(lspClient, "findReferences").mockResolvedValue([]);
    jest.spyOn(lspClient, "getTypeInfo").mockResolvedValue({
      contents: "const y: number",
    });

    const resDef = await handleLspQuery({
      filePath: "src/test.ts",
      line: 3,
      character: 6,
      action: "def",
    });
    expect(resDef).toContain("Go to Definition");

    const resRefs = await handleLspQuery({
      filePath: "src/test.ts",
      line: 0,
      character: 0,
      action: "refs",
    });
    expect(resRefs).toContain("Tidak ada referensi");

    const resType = await handleLspQuery({
      filePath: "src/test.ts",
      line: 0,
      character: 6,
      action: "type",
    });
    expect(resType).toContain("Type Info");
  });

  test("handles unsupported actions", async () => {
    const result = await handleLspQuery({
      filePath: "src/test.ts",
      line: 0,
      character: 0,
      action: "unknown" as any,
    });
    expect(result).toContain("tidak didukung");
  });
});

