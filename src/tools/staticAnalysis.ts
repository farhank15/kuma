import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";
import { spawnProcess, type ProcessResult } from "../utils/processRunner.js";

// ============================================================
// STATIC ANALYSIS — Passthrough linter/checker runner
// Calls eslint/tsc/ruff/prettier and parses output into structured results.
// NOT a built-in analyzer — delegates to existing tools.
// ============================================================

interface StaticAnalysisParams {
  tool?: "eslint" | "tsc" | "prettier" | "ruff" | "all";
  files?: string[];
  autoFix?: boolean;
  timeout?: number;
}

interface AnalysisIssue {
  file: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
  rule?: string;
  source: string;
}

interface AnalysisResult {
  tool: string;
  exitCode: number;
  issues: AnalysisIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
  };
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function handleStaticAnalysis(params: StaticAnalysisParams): Promise<string> {
  const { tool = "all", files, autoFix = false, timeout = 60 } = params;
  const root = getProjectRoot();

  sessionMemory.recordToolCall("static_analysis", { tool, files, autoFix });

  const availableTools = detectAvailableTools(root);
  if (availableTools.length === 0) {
    return formatNoToolsDetected();
  }

  const toolsToRun = tool === "all"
    ? availableTools
    : availableTools.filter((t) => t === tool);

  if (toolsToRun.length === 0) {
    return formatToolNotAvailable(tool, availableTools);
  }

  const allIssues: AnalysisIssue[] = [];
  const results: AnalysisResult[] = [];

  for (const t of toolsToRun) {
    const output = await runTool(t, root, files, autoFix, timeout);
    if (output === null) {
      results.push({ tool: t, exitCode: -1, issues: [], summary: { errors: 0, warnings: 0, info: 0 } });
      continue;
    }

    const issues = parseToolOutput(t, output.stdout, output.stderr, root);
    const result: AnalysisResult = {
      tool: t,
      exitCode: output.exitCode,
      issues,
      summary: {
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        info: issues.filter((i) => i.severity === "info").length,
      },
    };
    results.push(result);
    allIssues.push(...issues);

    if (result.summary.errors > 0 || result.summary.warnings > 0) {
      const errorMsg = result.summary.errors > 0
        ? result.summary.errors + " error(s)"
        : result.summary.warnings + " warning(s)";
      sessionMemory.addFailedFile("static_analysis:" + t, errorMsg + " found");
    }
  }

  return formatResults(results, allIssues, toolsToRun);
}

// ============================================================
// TOOL DETECTION
// ============================================================

type AvailableTool = "eslint" | "tsc" | "prettier" | "ruff";

function detectAvailableTools(root: string): AvailableTool[] {
  const tools: AvailableTool[] = [];
  const pkg = readPackageJson(root);
  const allDeps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) } as Record<string, string>;
  const depNames = new Set(Object.keys(allDeps));

  // ESLint: check config files AND package.json dependency
  const eslintConfigs = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    ".eslintrc.yaml",
    ".eslintrc.yml",
    "eslint.config.js",
    "eslint.config.mjs",
  ];
  const hasEslintConfig = eslintConfigs.some((cfg) => fs.existsSync(path.join(root, cfg)));
  if (hasEslintConfig && depNames.has("eslint")) {
    tools.push("eslint");
  }

  // TypeScript: check tsconfig.json AND package.json dependency
  if (fs.existsSync(path.join(root, "tsconfig.json")) && depNames.has("typescript")) {
    tools.push("tsc");
  }

  // Prettier: check config files AND package.json dependency
  const prettierConfigs = [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.js",
    ".prettierrc.yaml",
    ".prettierrc.toml",
    "prettier.config.js",
  ];
  const hasPrettierConfig = prettierConfigs.some((cfg) => fs.existsSync(path.join(root, cfg)));
  if (hasPrettierConfig && depNames.has("prettier")) {
    tools.push("prettier");
  }

  // Ruff: check config files (ruff is a Python tool, no package.json needed)
  if (
    fs.existsSync(path.join(root, "ruff.toml")) ||
    fs.existsSync(path.join(root, ".ruff.toml"))
  ) {
    tools.push("ruff");
  }

  return tools;
}

function readPackageJson(root: string): Record<string, unknown> | null {
  try {
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

// ============================================================
// TOOL EXECUTION
// ============================================================

async function runTool(
  tool: AvailableTool,
  cwd: string,
  files?: string[],
  autoFix?: boolean,
  timeoutSeconds?: number,
): Promise<ProcessResult | null> {
  const cmd = buildToolCommand(tool, files, autoFix);
  if (!cmd) return null;

  const result = await spawnProcess(cmd, {
    cwd,
    timeoutSeconds: timeoutSeconds ?? 60,
    maxStdout: 100_000, // Tool output can be large
    maxStderr: 50_000,
  });

  return result;
}



function buildToolCommand(tool: AvailableTool, files?: string[], autoFix?: boolean): string | null {
  const pm = detectPackageManagerPrefix();

  switch (tool) {
    case "eslint": {
      const fixFlag = autoFix ? " --fix" : "";
      const target = files ? files.join(" ") : ".";
      return pm + "eslint" + fixFlag + " " + target + " --format unix";
    }
    case "tsc": {
      return pm + "tsc --noEmit";
    }
    case "prettier": {
      const fixFlag = autoFix ? " --write" : " --check";
      const target = files ? files.join(" ") : ".";
      return pm + "prettier" + fixFlag + " " + target;
    }
    case "ruff": {
      const fixFlag = autoFix ? " --fix" : "";
      const target = files ? files.join(" ") : ".";
      return "ruff check" + fixFlag + " " + target;
    }
    default:
      return null;
  }
}

function detectPackageManagerPrefix(): string {
  const root = getProjectRoot();
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm ";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn ";
  return "npx --no-install "; // npm or bun — prevent accidental install prompts
}

// ============================================================
// OUTPUT PARSING
// ============================================================

function parseToolOutput(
  tool: AvailableTool,
  stdout: string,
  stderr: string,
  projectRoot: string,
): AnalysisIssue[] {
  switch (tool) {
    case "eslint":
      return parseEslintOutput(stdout, projectRoot);
    case "tsc":
      return parseTscOutput(stderr || stdout, projectRoot);
    case "prettier":
      return parsePrettierOutput(stdout, projectRoot);
    case "ruff":
      return parseRuffOutput(stdout, projectRoot);
    default:
      return [];
  }
}

/** Resolve a file path from tool output to a project-relative path */
function resolveToolPath(filePath: string, projectRoot: string): string {
  const trimmed = filePath.trim();
  return path.isAbsolute(trimmed)
    ? path.relative(projectRoot, trimmed)
    : trimmed.replace(/^\.\//, "");
}

/**
 * Parse ESLint output in Unix format:
 * <file>:<line>:<column>: <severity> <message> [<rule>]
 *
 * Handles Windows drive letters (C:\...). Uses non-greedy match
 * for file path to stop at the FIRST colon followed by digits.
 */
function parseEslintOutput(output: string, projectRoot: string): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  // Non-greedy .+? stops at first :digits:digits: pattern.
  // Rule ID in [brackets] is optional (some config errors have no rule).
  const lineRegex = /^(.+?):(\d+):(\d+):\s+(error|warning)\s+(.+?)(?:\s*\[([^\]]+)\])?\s*$/;

  for (const line of output.split("\n")) {
    const match = line.match(lineRegex);
    if (match) {
      const [, filePath, lineStr, colStr, severity, message, rule] = match;
      issues.push({
        file: resolveToolPath(filePath, projectRoot),
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
        severity: severity === "error" ? "error" : "warning",
        message: message.trim(),
        rule: rule?.trim() || undefined,
        source: "eslint",
      });
    }
  }

  return issues;
}

/**
 * Parse TSC output:
 * <file>(<line>,<column>): error TS<code>: <message>
 */
function parseTscOutput(output: string, projectRoot: string): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const lineRegex = /^(.+)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/;

  for (const line of output.split("\n")) {
    // Try TSC format first
    let match = line.match(lineRegex);
    if (match) {
      const [, filePath, lineStr, colStr, _severity, code, message] = match;
      issues.push({
        file: resolveToolPath(filePath, projectRoot),
        line: parseInt(lineStr, 10) || 1,
        column: parseInt(colStr, 10) || 1,
        severity: "error",
        message: message.trim(),
        rule: code.trim(),
        source: "tsc",
      });
      continue;
    }

    // Fallback: <file>(<line>,<column>): <message>
    const fallbackRegex = /^(.+)\((\d+),(\d+)\):\s+(.+)$/;
    match = line.match(fallbackRegex);
    if (match) {
      const [, filePath, lineStr, colStr, message] = match;
      issues.push({
        file: resolveToolPath(filePath, projectRoot),
        line: parseInt(lineStr, 10) || 1,
        column: parseInt(colStr, 10) || 1,
        severity: "error",
        message: message.trim(),
        source: "tsc",
      });
    }
  }

  return issues;
}

/**
 * Parse Prettier output:
 * <file> [error]
 */
function parsePrettierOutput(output: string, projectRoot: string): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  const lineRegex = /^(.+?)(?::(\d+):(\d+))?\s+\[error\]\s*(.+)?$/;

  for (const line of output.split("\n")) {
    const match = line.match(lineRegex);
    if (match) {
      const filePath = match[1].trim();
      if (!filePath || filePath.startsWith("[")) continue;
      issues.push({
        file: resolveToolPath(filePath, projectRoot),
        line: match[2] ? parseInt(match[2], 10) : 1,
        column: match[3] ? parseInt(match[3], 10) : 1,
        severity: "warning",
        message: match[4]?.trim() || "Formatting issue",
        rule: "prettier",
        source: "prettier",
      });
    }
  }

  return issues;
}

/**
 * Parse Ruff output:
 * <file>:<line>:<column>: <code> <message>
 *
 * Handles Windows drive letters (C:\...). Uses non-greedy match
 * for file path to stop at the FIRST colon followed by digits.
 */
function parseRuffOutput(output: string, projectRoot: string): AnalysisIssue[] {
  const issues: AnalysisIssue[] = [];
  // Non-greedy .+? stops at first :digits:digits: pattern
  const lineRegex = /^(.+?):(\d+):(\d+):\s+(\w+)\s+(.+)$/;

  for (const line of output.split("\n")) {
    const match = line.match(lineRegex);
    if (match) {
      const [, filePath, lineStr, colStr, rule, message] = match;
      issues.push({
        file: resolveToolPath(filePath, projectRoot),
        line: parseInt(lineStr, 10) || 1,
        column: parseInt(colStr, 10) || 1,
        severity: "warning",
        message: message.trim(),
        rule: rule.trim(),
        source: "ruff",
      });
    }
  }

  return issues;
}

// ============================================================
// FORMATTING
// ============================================================

function formatResults(
  results: AnalysisResult[],
  allIssues: AnalysisIssue[],
  toolsRun: AvailableTool[],
): string {
  const totalErrors = allIssues.filter((i) => i.severity === "error").length;
  const totalWarnings = allIssues.filter((i) => i.severity === "warning").length;
  const totalInfo = allIssues.filter((i) => i.severity === "info").length;
  const toolsStr = toolsRun.join(", ");
  const hasIssues = totalErrors > 0 || totalWarnings > 0 || totalInfo > 0;

  const lines: string[] = [
    "**Static Analysis**",
    "Tools: " + toolsStr,
    "",
    "Summary: " + totalErrors + " error(s), " + totalWarnings + " warning(s), " + totalInfo + " info",
    "",
  ];

  if (!hasIssues) {
    // Check if any tools failed to run (exit code non-zero but no issues parsed)
    const failedTools = results.filter(r => r.exitCode !== 0);
    if (failedTools.length > 0) {
      lines.push("Tool(s) executed but reported no parseable issues.");
      lines.push("Failed tools: " + failedTools.map(t => t.tool + " (exit: " + t.exitCode + ")").join(", "));
      lines.push("");
      lines.push("The tool may have encountered an error. Run it manually to see full output.");
    } else {
      lines.push("All checks passed — no issues found.");
    }
    lines.push("");
    lines.push("Use precise_diff_editor or batch_file_writer for the next changes.");
    return lines.join("\n");
  }

  // Group by file
  const byFile = new Map<string, AnalysisIssue[]>();
  for (const issue of allIssues) {
    const existing = byFile.get(issue.file) ?? [];
    existing.push(issue);
    byFile.set(issue.file, existing);
  }

  for (const [file, fileIssues] of byFile) {
    lines.push("--- " + file + " ---");
    for (const issue of fileIssues) {
      const severityTag = issue.severity === "error"
        ? "[ERROR]"
        : issue.severity === "warning"
        ? "[WARN]"
        : "[INFO]";
      const loc = "L" + issue.line + ":" + issue.column;
      const ruleStr = issue.rule ? " (" + issue.rule + ")" : "";
      lines.push("  " + severityTag + " " + loc + " — " + issue.message + ruleStr);
    }
    lines.push("");
  }

  // Per-tool summary
  lines.push("--- Per Tool ---");
  for (const result of results) {
    lines.push(
      "  " + result.tool + ": " +
      result.summary.errors + "E / " +
      result.summary.warnings + "W / " +
      result.summary.info + "I" +
      " (exit: " + result.exitCode + ")",
    );
  }

  lines.push("");
  lines.push("Use smart_file_picker to open a specific file and fix issues.");
  lines.push("Re-run static_analysis to verify fixes.");

  return lines.join("\n");
}

function formatNoToolsDetected(): string {
  return [
    "**Static Analysis**",
    "",
    "No linters or checkers detected for this project.",
    "",
    "Detected tools include:",
    "  - ESLint (check .eslintrc or eslint.config.*)",
    "  - TypeScript (check tsconfig.json)",
    "  - Prettier (check .prettierrc)",
    "  - Ruff (check ruff.toml)",
    "",
    "Install and configure a linter to use this tool.",
    "Then run project_conventions to refresh detection.",
  ].join("\n");
}

function formatToolNotAvailable(requested: string, available: AvailableTool[]): string {
  return [
    "**Static Analysis**",
    "",
    'Tool "' + requested + '" is not available for this project.',
    "",
    "Available tools: " + (available.length > 0 ? available.join(", ") : "none"),
    "",
    "Run static_analysis with tool: 'all' (default) to run all available tools.",
  ].join("\n");
}
