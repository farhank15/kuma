import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// ANTI-PATTERN DETECTOR — Detect when AI agents do the wrong thing
// ============================================================

export interface GuardWarning {
  severity: "high" | "medium" | "low";
  pattern: string;
  message: string;
  suggestion: string;
  evidence?: string;
  filePath?: string;
}

const SCRIPT_PATCH_PATTERNS = [
  "writeFileSync",
  "writeFile",
  "replace(",
  "replaceAll(",
  "sed",
  "awk",
  "fs.write",
  "patch",
  "modify",
];

const BASH_GREP_PATTERNS = [
  "grep -rn",
  "grep -r",
  "grep -n",
  "| grep",
  "ripgrep",
  "rg ",
  "ag ",
];

const SCRIPT_EXTENSIONS = [".py", ".js", ".mjs", ".cjs", ".ts"];

/**
 * Scan for newly created files in project root that look like patch scripts.
 * These are scripts created by AI to modify other files — a known anti-pattern.
 */
function findPatchScripts(projectRoot: string): GuardWarning[] {
  const warnings: GuardWarning[] = [];
  const recentFiles = scanRecentFiles(projectRoot);

  for (const file of recentFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!SCRIPT_EXTENSIONS.includes(ext)) continue;

    // Skip files in src/, tests/, node_modules/
    const relativePath = path.relative(projectRoot, file);
    if (relativePath.startsWith("src") || relativePath.startsWith("test")
        || relativePath.startsWith("node_modules") || relativePath.startsWith(".")) {
      continue;
    }

    try {
      const content = fs.readFileSync(file, "utf-8").toLowerCase();
      const matchedPattern = SCRIPT_PATCH_PATTERNS.find((p) => content.includes(p.toLowerCase()));
      if (matchedPattern) {
        warnings.push({
          severity: "high",
          pattern: "script-patching",
          message: `Created script file that modifies other files: ${path.basename(file)}`,
          suggestion: "Use **precise_diff_editor** instead — it has fuzzy matching, auto-backup, and rollback support",
          evidence: `File: ${relativePath} contains '${matchedPattern}'`,
          filePath: relativePath,
        });
      }
    } catch {
      // Ignore read errors
    }
  }

  return warnings;
}

/**
 * Check session memory for bash commands that use grep manually.
 */
function detectBashGrepUsage(): GuardWarning[] {
  const warnings: GuardWarning[] = [];
  const toolCalls = sessionMemory.getToolCallHistory(100);

  for (const call of toolCalls) {
    if (call.toolName !== "execute_safe_test") continue;
    const cmd = (call.params as Record<string, unknown>)?.customCommand as string
               || (call.params as Record<string, unknown>)?.command as string
               || "";

    const matchedPattern = BASH_GREP_PATTERNS.find((p) => cmd.toLowerCase().includes(p));
    if (matchedPattern) {
      warnings.push({
        severity: "medium",
        pattern: "bash-grep",
        message: `Used bash grep instead of smart_grep`,
        suggestion: "Use **smart_grep** — it returns line numbers + context, caches results, respects .gitignore",
        evidence: `Command: ${cmd.substring(0, 120)}`,
      });
      break;
    }
  }

  return warnings;
}

/**
 * Check for newly created root-level files (potential scripts).
 */
function scanRecentFiles(projectRoot: string): string[] {
  const recent: string[] = [];

  try {
    const entries = fs.readdirSync(projectRoot, { withFileTypes: true });
    const now = Date.now();
    const recentThreshold = 30 * 60 * 1000; // 30 minutes

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      try {
        const stat = fs.statSync(path.join(projectRoot, entry.name));
        if (now - stat.mtimeMs < recentThreshold || now - stat.ctimeMs < recentThreshold) {
          recent.push(path.join(projectRoot, entry.name));
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore read errors
  }

  return recent;
}

/**
 * Scan git status and diff for newly created patch scripts.
 * Catches scripts that were created (staged or untracked) and might have been deleted after use.
 */
function detectGitPatchScripts(projectRoot: string): GuardWarning[] {
  const warnings: GuardWarning[] = [];

  try {
    // 1. Check git status --porcelain for untracked (?? ) and new staged (A ) files
    const statusStdout = execSync("git status --porcelain", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();

    if (statusStdout) {
      const lines = statusStdout.split("\n").filter(Boolean);
      for (const line of lines) {
        // '?? ' = untracked, 'A ' = staged new, ' M' = modified
        const prefix = line.substring(0, 2);
        if (prefix !== "??" && prefix !== "A ") continue;

        const file = line.substring(3).trim();
        const ext = path.extname(file).toLowerCase();
        if (!SCRIPT_EXTENSIONS.includes(ext)) continue;

        // Only flag root-level or scripts/patches/ dir files
        const isRootLevel = !file.includes("/");
        const isScriptsDir = file.startsWith("scripts/") || file.startsWith("patches/");
        if (!isRootLevel && !isScriptsDir) continue;

        // Check actual content for file-modification patterns
        const fullPath = path.join(projectRoot, file);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf-8").toLowerCase();
          const matchedPattern = SCRIPT_PATCH_PATTERNS.find((p) => content.includes(p.toLowerCase()));
          if (matchedPattern) {
            warnings.push({
              severity: "high",
              pattern: "script-patching",
              message: `Patch script detected: ${file}`,
              suggestion: "Use **precise_diff_editor** instead — it has fuzzy matching, auto-backup, and rollback support",
              evidence: `File: ${file} (contains '${matchedPattern}')`,
              filePath: file,
            });
          }
        }
      }
    }

    // 2. Check git diff for deleted tracked files (scripts created then deleted)
    const deletedStdout = execSync("git diff --name-only --diff-filter=D HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();

    if (deletedStdout) {
      const deletedFiles = deletedStdout.split("\n").filter(Boolean);
      for (const file of deletedFiles) {
        const ext = path.extname(file).toLowerCase();
        if (SCRIPT_EXTENSIONS.includes(ext)) {
          warnings.push({
            severity: "high",
            pattern: "script-patching",
            message: `Patch script was tracked then deleted: ${file}`,
            suggestion: "Use **precise_diff_editor** instead of creating disposable scripts. It has auto-backup + rollback.",
            evidence: `Git shows ${file} was deleted`,
            filePath: file,
          });
        }
      }
    }
  } catch {
    // Not a git repo or git not available - skip git-based detection
  }

  return warnings;
}

/**
 * Check for bash sed/awk command usage in session memory.
 * These are often used as quick alternatives to precise_diff_editor.
 */
function detectBashSedUsage(): GuardWarning[] {
  const warnings: GuardWarning[] = [];
  const toolCalls = sessionMemory.getToolCallHistory(100);

  const SED_PATTERNS = [
    "sed -i",
    "sed \\'",
    "sed '",
    "awk '",
    "awk \\'",
    "cat <<",
    ">> \"$file",
    ">> '$file",
    "echo \" >> ",
    "echo ' >> ",
    "printf '%s' >",
  ];

  for (const call of toolCalls) {
    if (call.toolName !== "execute_safe_test") continue;
    const cmd = (call.params as Record<string, unknown>)?.customCommand as string
               || (call.params as Record<string, unknown>)?.command as string
               || "";

    if (SED_PATTERNS.some((p) => cmd.includes(p))) {
      warnings.push({
        severity: "high",
        pattern: "bash-sed-editing",
        message: "Used bash sed/awk to edit source files instead of precise_diff_editor",
        suggestion: "Use **precise_diff_editor** for all file modifications — it has fuzzy matching, auto-backup, and rollback.\n\n✅ Correct format:\nprecise_diff_editor({\n  filePath: \"src/file.ts\",\n  edits: [\n    { searchBlock: \"old code\", replaceBlock: \"new code\" }\n  ]\n})",
        evidence: `Command: ${cmd.substring(0, 150)}`,
      });
      break;
    }
  }

  return warnings;
}

/**
 * Main entry: run all anti-pattern checks.
 */
export function detectAllAntiPatterns(): GuardWarning[] {
  const projectRoot = getProjectRoot();
  const warnings: GuardWarning[] = [];

  warnings.push(...findPatchScripts(projectRoot));
  warnings.push(...detectBashGrepUsage());
  warnings.push(...detectGitPatchScripts(projectRoot));
  warnings.push(...detectBashSedUsage());

  return warnings;
}
