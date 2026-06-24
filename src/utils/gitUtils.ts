import { execSync } from "node:child_process";
import { getProjectRoot } from "./pathValidator.js";

// ============================================================
// GIT UTILS — Shared git helpers extracted from gitDiff.ts & gitLog.ts
// ============================================================

/**
 * Run a git command in the project root with a 2MB output buffer limit.
 * Returns stdout as string.
 * Throws if the command fails or is not a git repository.
 */
export function runGitCommand(command: string): string {
  const root = getProjectRoot();
  return execSync(command, {
    cwd: root,
    encoding: "utf-8",
    maxBuffer: 2 * 1024 * 1024,
  });
}

/**
 * Check if git is available and the project is a git repository.
 * Returns true/false without throwing.
 */
export function isGitRepo(): boolean {
  try {
    execSync("git rev-parse --git-dir", {
      cwd: getProjectRoot(),
      encoding: "utf-8",
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the root of the git repository.
 * Returns null if not a git repo.
 */
export function getGitRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: getProjectRoot(),
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}
