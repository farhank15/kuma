import { jest } from "@jest/globals";
import { handleGitLog } from "../src/tools/gitLog.js";
import child_process from "node:child_process";

describe("gitLog", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("returns commit log successfully", async () => {
    jest.spyOn(child_process, "execSync").mockReturnValue(
      "a1b2c3d feat: initial commit\n5e6f7g8 chore: bump version"
    );

    const result = await handleGitLog({ maxCount: 2 });
    expect(result).toContain("Git Commit History");
    expect(result).toContain("feat: initial commit");
  });

  test("handles empty git history", async () => {
    jest.spyOn(child_process, "execSync").mockReturnValue("");

    const result = await handleGitLog({ filePath: "nonexistent.ts" });
    expect(result).toContain("Tidak ada commit history ditemukan");
  });

  test("handles execution errors gracefully", async () => {
    jest.spyOn(child_process, "execSync").mockImplementation(() => {
      throw new Error("Command failed");
    });

    const result = await handleGitLog({});
    expect(result).toContain("Error");
    expect(result).toContain("Command failed");
  });
});
