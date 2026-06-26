import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { validateFilePath, getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// CODE REVIEWER — Senior-level static review for changed code
// ============================================================
// Pattern-based (regex + line heuristics). Not a full type-checker.
// Designed to catch the smells a senior would flag on first read.

interface CodeReviewerParams {
  files?: string[];
  focus?: "correctness" | "conventions" | "security" | "performance" | "over-engineering";
  customCriteria?: string;
  format?: "text" | "json";
  convention?: "matcha" | "none";
}

interface ReviewIssue {
  file: string;
  line: number;
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  suggestion: string;
}

const CODE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".php", ".cs", ".java",
  ".json", ".jsonc", ".yaml", ".yml", ".toml",
];

const CONFIG_EXTENSIONS = [
  ".json", ".jsonc", ".yaml", ".yml", ".toml",
];

function getGitChangedFiles(): string[] {
  try {
    const root = getProjectRoot();
    const stdout = execSync("git status --porcelain", {
      cwd: root,
      encoding: "utf-8",
    });
    const files: string[] = [];
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      let filePath = parts.slice(1).join(" ");
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.substring(1, filePath.length - 1);
      }
      const ext = path.extname(filePath).toLowerCase();
      if (CODE_EXTENSIONS.includes(ext)) files.push(filePath);
    }
    return files.slice(0, 10);
  } catch (err) {
    console.error(`[CodeReviewer] Failed to list git-changed files: ${err}`);
    return [];
  }
}

export async function handleCodeReviewer(
  params: CodeReviewerParams,
): Promise<string> {
  const { files: inputFiles, focus = "correctness", customCriteria, format = "text", convention } = params;

  let files = inputFiles ?? [];
  let isAutoDetected = false;

  if (files.length === 0) {
    files = getGitChangedFiles();
    isAutoDetected = true;
    if (files.length === 0) {
      return `ℹ️ No code files (TS/JS/Python/Go/Rust/PHP/C#/Java) detected as changed in git status.\nPass an explicit 'files' array to review specific files.`;
    }
  }

  const allIssues: ReviewIssue[] = [];
  let filesReviewed = 0;

  for (const filePath of files) {
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      allIssues.push({
        file: filePath,
        line: 0,
        severity: "error",
        rule: "path/invalid",
        message: `Invalid path: ${validation.error.message}`,
        suggestion: "Fix the file path",
      });
      continue;
    }

    const resolvedPath = validation.resolvedPath;
    if (!fs.existsSync(resolvedPath)) {
      allIssues.push({
        file: filePath,
        line: 0,
        severity: "error",
        rule: "path/not-found",
        message: "File not found",
        suggestion: "Verify the file path",
      });
      continue;
    }

    try {
      const content = fs.readFileSync(resolvedPath, "utf-8");
      filesReviewed++;

      // Always run general/file-wide checks
      checkGeneral(filePath, content, allIssues);

      // Focus-specific checks
      switch (focus) {
        case "correctness":
          checkCorrectness(filePath, content, allIssues);
          break;
        case "conventions":
          checkConventions(filePath, content, allIssues);
          break;
        case "security":
          checkSecurity(filePath, content, allIssues);
          break;
        case "performance":
          checkPerformance(filePath, content, allIssues);
          break;
        case "over-engineering":
          checkOverEngineering(filePath, content, allIssues);
          break;
      }

      // Matcha specific conventions
      if (convention === "matcha") {
        checkMatchaConventions(filePath, content, allIssues);
      }
    } catch (err) {
      allIssues.push({
        file: filePath,
        line: 0,
        severity: "error",
        rule: "io/read-failed",
        message: `Error reading file: ${err}`,
        suggestion: "",
      });
    }
  }

  sessionMemory.recordToolCall("code_reviewer", {
    filesReviewed,
    focus,
    issuesFound: allIssues.length,
    errors: allIssues.filter((i) => i.severity === "error").length,
    autoDetected: isAutoDetected,
  });

  if (format === "json") {
    const jsonSummary = {
      totalIssues: allIssues.length,
      errors: allIssues.filter((i) => i.severity === "error").length,
      warnings: allIssues.filter((i) => i.severity === "warning").length,
      info: allIssues.filter((i) => i.severity === "info").length,
      filesReviewed,
      filesRequested: files.length,
      focus,
      convention,
      autoDetected: isAutoDetected,
      ...(customCriteria ? { customCriteria } : {}),
    };

    const issuesByFile: Record<string, ReviewIssue[]> = {};
    for (const issue of allIssues) {
      if (!issuesByFile[issue.file]) issuesByFile[issue.file] = [];
      issuesByFile[issue.file].push(issue);
    }

    return JSON.stringify({ summary: jsonSummary, issuesByFile, issues: allIssues }, null, 2);
  }

  return formatReviewOutput(allIssues, filesReviewed, files.length, focus, customCriteria, isAutoDetected);
}

// ============================================================
// SHARED HELPERS
// ============================================================

// Strip line comments and string literals so regex checks don't false-positive
// on words appearing inside comments or strings.
function stripCommentsAndStrings(line: string): string {
  let result = "";
  let i = 0;
  let inString: string | null = null;
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];
    if (inString) {
      if (ch === "\\" && i + 1 < line.length) { i += 2; continue; }
      if (ch === inString) { inString = null; i++; continue; }
      i++;
      continue;
    }
    if (ch === "/" && next === "/") break; // line comment
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; i++; continue; }
    result += ch;
    i++;
  }
  return result;
}

function isTestFile(filePath: string): boolean {
  return /\.(test|spec)\.[a-z]+$/i.test(filePath) || /__tests__/.test(filePath);
}

function isTsLike(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".ts" || ext === ".tsx";
}

// ============================================================
// GENERAL CHECKS — run for every focus
// ============================================================

function checkGeneral(filePath: string, content: string, issues: ReviewIssue[]): void {
  const lines = content.split("\n");
  const ext = path.extname(filePath).toLowerCase();

  // File ends with newline
  if (content.length > 0 && !content.endsWith("\n")) {
    issues.push({
      file: filePath,
      line: lines.length,
      severity: "info",
      rule: "style/final-newline",
      message: "File does not end with a newline",
      suggestion: "Add a trailing newline",
    });
  }

  // File is very long — signal to split
  if (lines.length > 500) {
    issues.push({
      file: filePath,
      line: 1,
      severity: "info",
      rule: "complexity/file-too-long",
      message: `File is ${lines.length} lines — consider splitting`,
      suggestion: "Extract cohesive sections into separate modules",
    });
  }

  // Config file checks (JSON / YAML / TOML)
  if (CONFIG_EXTENSIONS.includes(ext)) {
    checkConfigFile(filePath, content, issues);
  }
}

// ============================================================
// CORRECTNESS CHECKS
// ============================================================

function checkCorrectness(filePath: string, content: string, issues: ReviewIssue[]): void {
  const lines = content.split("\n");
  const isTest = isTestFile(filePath);
  const isTs = isTsLike(filePath);

  // Detect deeply-nested code by tracking max brace depth
  let braceDepth = 0;
  let maxDepth = 0;
  let maxDepthLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = stripCommentsAndStrings(rawLine);
    const lineNum = i + 1;

    // Track nesting via braces (rough but useful)
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
      if (braceDepth > maxDepth) {
        maxDepth = braceDepth;
        maxDepthLine = lineNum;
      }
    }

    // Leftover console.log (skip tests)
    if (!isTest && /\bconsole\.(log|debug|info)\s*\(/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        rule: "correctness/console-log",
        message: "Leftover console.log",
        suggestion: "Remove or replace with a structured logger",
      });
    }

    // TODO / FIXME / HACK / XXX
    if (/\b(TODO|FIXME|HACK|XXX)\b/.test(rawLine)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        rule: "correctness/todo",
        message: "Unresolved TODO/FIXME/HACK marker",
        suggestion: "Resolve or file a tracked issue and link it",
      });
    }

    // TypeScript-specific
    if (isTs) {
      // 'any' annotation (excluding 'as any' which is caught separately)
      if (/:\s*any\b/.test(line) && !/eslint-disable/.test(rawLine)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          rule: "ts/no-any",
          message: "'any' type annotation",
          suggestion: "Replace with a specific type or 'unknown'",
        });
      }

      // 'as any' cast — high-severity smell
      if (/\bas\s+any\b/.test(line)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "error",
          rule: "ts/no-as-any",
          message: "'as any' cast bypasses the type system",
          suggestion: "Narrow with a type guard or cast to 'unknown' then validate",
        });
      }

      // Chained 'as' casts (double cast) — usually a workaround for a bad type
      if (/\)\s*as\s+\w[^;]*\bas\s+\w/.test(line)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          rule: "ts/double-cast",
          message: "Chained 'as' casts indicate a type-modeling problem",
          suggestion: "Fix the upstream type or use a type guard",
        });
      }

      // Non-null assertion (!.) — overuse hides nullability bugs
      if (/[a-zA-Z_$\]\)]\s*!\s*\./.test(line) && !/!==|!=/.test(line)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          rule: "ts/non-null-assertion",
          message: "Non-null assertion (!) suppresses null checks",
          suggestion: "Use optional chaining or an explicit guard",
        });
      }

      // @ts-ignore
      if (/@ts-ignore\b/.test(rawLine)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          rule: "ts/ts-ignore",
          message: "@ts-ignore silently suppresses type errors",
          suggestion: "Use @ts-expect-error with a reason, or fix the underlying type",
        });
      }

      // Untyped Function type
      if (/:\s*Function\b/.test(line)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          rule: "ts/no-unsafe-function",
          message: "'Function' type is unsafe (loses signature)",
          suggestion: "Use a specific signature like (x: T) => U",
        });
      }
    }

    // Empty catch block (single-line or following lines)
    if (/catch\s*\([^)]*\)\s*{\s*}/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "error",
        rule: "correctness/empty-catch",
        message: "Empty catch swallows the error",
        suggestion: "Log the error or rethrow — silent catch hides bugs",
      });
    }

    // Hardcoded secrets (skip env var references)
    if (/(password|secret|api[_-]?key|token|bearer)\s*[:=]\s*['"][^'"]{6,}['"]/i.test(line)
        && !/process\.env|import\.meta\.env|getenv|os\.environ/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "error",
        rule: "security/hardcoded-secret",
        message: "Possible hardcoded secret",
        suggestion: "Read from an environment variable instead",
      });
    }

    // async function with no await inside (best-effort: check next 30 lines for await up to closing brace)
    const asyncFnMatch = line.match(/\basync\s+(function\b|\([^)]*\)\s*=>|[a-zA-Z_$][\w$]*\s*\()/);
    if (asyncFnMatch) {
      const body = lines.slice(i, Math.min(i + 40, lines.length)).join("\n");
      if (!/\bawait\b/.test(body) && !/return\s+\w+\s*\(/.test(body)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "info",
          rule: "correctness/async-without-await",
          message: "async function without await",
          suggestion: "Drop 'async' or add the awaited call",
        });
      }
    }

    // == / != instead of === / !==
    if (isTs || /\.(js|jsx|mjs|cjs)$/i.test(filePath)) {
      if (/[^=!<>]==[^=]/.test(line) || /!=[^=]/.test(line)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          rule: "correctness/loose-equality",
          message: "Loose equality (==/!=) — prefer strict equality",
          suggestion: "Use === / !==",
        });
      }
    }

    // Floating Promise: `someAsyncCall(...);` without await/then/catch/return
    if (isTs && /^\s*[a-zA-Z_$][\w$]*\([^)]*\)\.[a-zA-Z]/.test(line) === false) {
      // intentional skip — too noisy without AST
    }
  }

  // Report deeply nested code (>= 5 levels)
  if (maxDepth >= 5) {
    issues.push({
      file: filePath,
      line: maxDepthLine,
      severity: "warning",
      rule: "complexity/deep-nesting",
      message: `Code nests ${maxDepth} levels deep`,
      suggestion: "Extract helper functions or use early returns",
    });
  }
}

/** Strip JS-style comments from JSON content (for .jsonc support) */
function stripJsonComments(text: string): string {
  // Strip block comments /* ... */
  let result = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip line comments // ...
  const lines = result.split("\n");
  const cleaned = lines.map(line => {
    const commentIdx = line.indexOf("//");
    if (commentIdx === -1) return line;
    // Count quotes before // — if odd, the // is inside a string
    const before = line.substring(0, commentIdx);
    const quoteCount = (before.match(/"/g) || []).length;
    if (quoteCount % 2 === 0) {
      return before;
    }
    return line;
  });
  return cleaned.join("\n");
}

// ============================================================
// CONFIG FILE CHECKS (JSON / YAML / TOML)
// ============================================================

function checkConfigFile(filePath: string, content: string, issues: ReviewIssue[]): void {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split("\n");

  if (ext === ".json" || ext === ".jsonc") {
    checkJson(filePath, content, lines, issues);
  } else if (ext === ".yaml" || ext === ".yml") {
    checkYaml(filePath, content, lines, issues);
  } else if (ext === ".toml") {
    checkToml(filePath, content, lines, issues);
  }
}

/** JSON-specific checks: parse validation, trailing commas, duplicate keys, quote style */
function checkJson(filePath: string, content: string, lines: string[], issues: ReviewIssue[]): void {
  const ext = path.extname(filePath).toLowerCase();
  const isJsonc = ext === ".jsonc";

  // 1. Try JSON.parse — strip comments first for .jsonc files
  const contentToParse = isJsonc ? stripJsonComments(content) : content;
  try {
    JSON.parse(contentToParse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If .jsonc file has comments and JSON.parse failed, check if comments are the cause
    if (isJsonc && /\/\/|\/\*/.test(content)) {
      issues.push({
        file: filePath,
        line: 1,
        severity: "info",
        rule: "jsonc/comments-stripped",
        message: "JSON with Comments — comments were stripped for validation. Check the remaining syntax.",
        suggestion: "If issues remain, check quotes, commas, braces after comment removal",
      });
      return;  // Don't report generic parse error for .jsonc — comments cause noise
    }

    // Try to extract line number from parse error
    const posMatch = msg.match(/position\s+(\d+)/i);
    const lineMatch = msg.match(/line\s+(\d+)/i);
    let errorLine = 1;
    if (lineMatch) {
      errorLine = parseInt(lineMatch[1], 10);
    } else if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      let charCount = 0;
      for (let i = 0; i < lines.length; i++) {
        charCount += lines[i].length + 1;
        if (charCount >= pos) {
          errorLine = i + 1;
          break;
        }
      }
    }
    issues.push({
      file: filePath,
      line: errorLine,
      severity: "error",
      rule: "json/parse-error",
      message: `Invalid JSON: ${msg.substring(0, 120)}`,
      suggestion: "Fix the syntax error — check quotes, commas, braces, and brackets",
    });
  }

  // 2. Check for trailing commas (common mistake)
  // Look for any line ending with comma where the next non-empty line closes the structure
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!/,\s*$/.test(trimmed)) continue;

    // Check if next non-empty line closes the structure
    let nextNonEmpty = "";
    for (let j = i + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("#")) {
        nextNonEmpty = t;
        break;
      }
    }
    if (nextNonEmpty === "]" || nextNonEmpty === "}" || nextNonEmpty === "]," || nextNonEmpty === "},") {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "error",
        rule: "json/trailing-comma",
        message: "Trailing comma before closing bracket/brace",
        suggestion: "Remove the trailing comma after the last element",
      });
    }
  }

  // 3. Check for duplicate keys (only for valid JSON)
  try {
    const parsed = JSON.parse(content);
    findDuplicateKeys(parsed, "", filePath, issues, lines);
  } catch {
    // Already reported parse error above
  }

  // 4. Check for single quotes (invalid in strict JSON)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for patterns like: 'key':  or : 'value'
    if ((/\s+'[a-zA-Z_][a-zA-Z0-9_]*'\s*:/.test(line) || /:\s*'[^']*'\s*[,}\]$]/.test(line)) &&
        !/\/\//.test(line)) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "warning",
        rule: "json/single-quote",
        message: "Single quotes used — JSON requires double quotes",
        suggestion: "Replace ' with \"",
      });
      break;  // One warning is enough
    }
  }
}

/** Recursively find duplicate keys in a parsed JSON object */
function findDuplicateKeys(obj: unknown, nestedPath: string, filePath: string, issues: ReviewIssue[], lines: string[]): void {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return;

  const keys = Object.keys(obj as Record<string, unknown>);
  const seen = new Map<string, number>();

  for (const key of keys) {
    if (seen.has(key)) {
      // Find approximate line number for the duplicate
      const searchStr = `"${key}"`;
      let lineNum = 1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(searchStr)) {
          lineNum = i + 1;
          break;
        }
      }
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        rule: "json/duplicate-key",
        message: `Duplicate key "${key}" in ${nestedPath || "root"}`,
        suggestion: "Remove or rename the duplicate — last value wins in JSON",
      });
    }
    seen.set(key, 1);
  }

  // Recurse into nested objects
  for (const key of keys) {
    const deeperPath = nestedPath ? `${nestedPath}.${key}` : key;
    findDuplicateKeys((obj as Record<string, unknown>)[key], deeperPath, filePath, issues, lines);
  }
}

/** YAML-specific checks: indentation, tabs, common mistakes */
function checkYaml(filePath: string, _content: string, lines: string[], issues: ReviewIssue[]): void {
  let hasTabs = false;
  let hasSpaces = false;
  let inconsistentIndent = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Check for tab characters in indentation
    if (rawLine.startsWith("\t")) hasTabs = true;

    // Check for space indentation
    const spaceMatch = rawLine.match(/^( +)/);
    if (spaceMatch) {
      hasSpaces = true;
      const indent = spaceMatch[1].length;

      // Check for inconsistent indentation (odd spacing, not multiple of 2)
      if (indent % 2 !== 0 && indent !== 0) {
        inconsistentIndent = true;
      }
    }
  }

  // Report tab usage
  if (hasTabs) {
    issues.push({
      file: filePath,
      line: 1,
      severity: "error",
      rule: "yaml/tab-indent",
      message: "YAML uses spaces for indentation — tabs are not allowed",
      suggestion: "Replace tabs with spaces (2 spaces per indent level)",
    });
  }

  // Report inconsistent indentation
  if (inconsistentIndent) {
    issues.push({
      file: filePath,
      line: 1,
      severity: "warning",
      rule: "yaml/inconsistent-indent",
      message: "Indentation depth is not a multiple of 2 — may cause parsing issues",
      suggestion: "Use consistent 2-space indentation throughout the file",
    });
  }

  // Check for common YAML mistakes
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Unquoted URLs with colons (e.g., https://example.com)
    if (/^https?:\/\//.test(trimmed) || /:\s*https?:\/\//.test(trimmed)) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "info",
        rule: "yaml/unquoted-url",
        message: "URL should be quoted to avoid colon parsing ambiguity",
        suggestion: "Wrap URL in quotes: \"https://...\"",
      });
    }

    // Bool values that might be misinterpreted (yes/no/on/off)
    if (/^\s*\w+:\s*(yes|no|on|off)\s*$/.test(lines[i])) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "info",
        rule: "yaml/ambiguous-bool",
        message: "Ambiguous boolean value — YAML interprets yes/no/on/off as booleans",
        suggestion: "Use true/false instead for clarity, or quote the value",
      });
    }
  }

  // Mixed tabs and spaces
  if (hasTabs && hasSpaces) {
    issues.push({
      file: filePath,
      line: 1,
      severity: "error",
      rule: "yaml/mixed-indent",
      message: "Mixed tabs and spaces in indentation",
      suggestion: "Use spaces only (2 spaces per level)",
    });
  }
}

/** TOML-specific checks: duplicate keys, format consistency */
function checkToml(filePath: string, _content: string, lines: string[], issues: ReviewIssue[]): void {
  const seenKeys = new Map<string, number>();
  const arrayTables = new Set<string>();
  let currentTable = "";

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Track table headers
    // [[array]] for arrays of tables (allow duplicates), [table] for standard tables
    const isArrayTable = trimmed.startsWith("[[");
    const tableMatch = trimmed.match(/^\[\[?(.+?)\]?\]$/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      if (isArrayTable) {
        arrayTables.add(currentTable);
      }
      continue;
    }

    // Track key-value pairs (skip array-of-table entries — they naturally repeat)
    const kvMatch = trimmed.match(/^(\w+)\s*=/);
    if (kvMatch) {
      const fullKey = currentTable ? `${currentTable}.${kvMatch[1]}` : kvMatch[1];

      // Skip duplicate check if this key is inside an array-of-tables (duplicates allowed by design)
      const parentTable = currentTable.split(".").slice(0, -1).join(".");
      const isInArrayTable = arrayTables.has(currentTable) || arrayTables.has(parentTable);

      if (seenKeys.has(fullKey)) {
        if (!isInArrayTable) {
          const prevLine = seenKeys.get(fullKey)!;
          issues.push({
            file: filePath,
            line: i + 1,
            severity: "warning",
            rule: "toml/duplicate-key",
            message: `Duplicate key "${fullKey}" (first defined at line ${prevLine})`,
            suggestion: "Remove or rename the duplicate — only last value is kept",
          });
        }
      } else {
        seenKeys.set(fullKey, i + 1);
      }
    }

    // Check for inline table with duplicate keys
    if (/\{[^}]*\}/.test(trimmed)) {
      const inlineContent = trimmed.match(/\{([^}]*)\}/);
      if (inlineContent) {
        const inlineKeys = inlineContent[1].match(/(\w+)\s*=/g);
        if (inlineKeys) {
          const inlineSeen = new Set<string>();
          for (const k of inlineKeys) {
            const keyName = k.replace(/\s*=\s*$/, "").trim();
            if (inlineSeen.has(keyName)) {
              issues.push({
                file: filePath,
                line: i + 1,
                severity: "warning",
                rule: "toml/duplicate-inline-key",
                message: `Duplicate key "${keyName}" in inline table`,
                suggestion: "Remove the duplicate key",
              });
            }
            inlineSeen.add(keyName);
          }
        }
      }
    }
  }
}

// ============================================================
// CONVENTIONS CHECKS
// ============================================================

function checkConventions(filePath: string, content: string, issues: ReviewIssue[]): void {
  const lines = content.split("\n");

  // Mixed indentation
  let hasTabs = false;
  let hasSpaces = false;
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (lines[i].startsWith("\t")) hasTabs = true;
    if (/^ {2,}/.test(lines[i])) hasSpaces = true;
  }
  if (hasTabs && hasSpaces) {
    issues.push({
      file: filePath,
      line: 1,
      severity: "warning",
      rule: "style/mixed-indent",
      message: "Mixed indentation (tabs and spaces)",
      suggestion: "Pick one (typically 2 spaces for JS/TS)",
    });
  }

  // Line length
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 200) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "info",
        rule: "style/line-length",
        message: `Line is ${lines[i].length} chars`,
        suggestion: "Wrap lines over ~120 chars",
      });
      break;
    }
  }

  // Naming conventions
  for (let i = 0; i < lines.length; i++) {
    const line = stripCommentsAndStrings(lines[i]);

    const classMatch = line.match(/\bclass\s+([a-zA-Z_$][\w$]*)/);
    if (classMatch && !/^[A-Z]/.test(classMatch[1])) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "warning",
        rule: "naming/class-pascalcase",
        message: `Class "${classMatch[1]}" should be PascalCase`,
        suggestion: `Rename to "${classMatch[1].charAt(0).toUpperCase() + classMatch[1].slice(1)}"`,
      });
    }

    const funcMatch = line.match(/\bfunction\s+([A-Z][a-zA-Z0-9_$]*)\s*\(/);
    if (funcMatch && !/React|Component/.test(line)) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "info",
        rule: "naming/function-camelcase",
        message: `Function "${funcMatch[1]}" starts with uppercase (component?)`,
        suggestion: "Use camelCase for regular functions",
      });
    }
  }
}

// ============================================================
// SECURITY CHECKS
// ============================================================

function checkSecurity(filePath: string, content: string, issues: ReviewIssue[]): void {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = stripCommentsAndStrings(rawLine);
    const lineNum = i + 1;

    if (/\beval\s*\(/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "error",
        rule: "security/no-eval",
        message: "eval() is a security risk",
        suggestion: "Use JSON.parse or a real parser",
      });
    }

    if (/\.innerHTML\s*=/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        rule: "security/innerhtml",
        message: "innerHTML can lead to XSS",
        suggestion: "Use textContent or sanitize with DOMPurify",
      });
    }

    if (/\.query\s*\(\s*[`'"][^`'"]*(SELECT|INSERT|UPDATE|DELETE)/i.test(line)
        && /\$\{|\+\s*\w/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "error",
        rule: "security/sql-injection",
        message: "SQL query built via string interpolation",
        suggestion: "Use parameterized queries or an ORM",
      });
    }

    if (/\b(exec|execSync|spawn|spawnSync)\s*\(/.test(line)
        && /\$\{|\+\s*\w/.test(line)
        && !/\/\/\s*reviewed/i.test(rawLine)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        rule: "security/shell-injection",
        message: "Shell command built from interpolated input",
        suggestion: "Sanitize input or use array-form spawn with explicit args",
      });
    }

    // Insecure HTTP in code (skip docs/comments — stripCommentsAndStrings already removed strings/comments)
    if (/['"]http:\/\/(?!localhost|127\.|0\.0\.0\.0)/.test(rawLine)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        rule: "security/insecure-http",
        message: "Insecure http:// URL",
        suggestion: "Use https:// where possible",
      });
    }
  }
}

// ============================================================
// PERFORMANCE CHECKS
// ============================================================

function checkPerformance(filePath: string, content: string, issues: ReviewIssue[]): void {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = stripCommentsAndStrings(lines[i]);
    const lineNum = i + 1;

    // Nested loops (rough)
    if (/\b(for|while)\s*\(/.test(line) && i > 0 && /\b(for|while)\s*\(/.test(stripCommentsAndStrings(lines[i - 1]))) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        rule: "perf/nested-loops",
        message: "Nested loops — potential O(n²)",
        suggestion: "Use Map/Set lookups or a single-pass algorithm",
      });
    }

    // Array method inside a loop (rough)
    if (/\.(filter|map|reduce|find)\s*\(/.test(line) && i > 0 && /\bfor\s*\(/.test(stripCommentsAndStrings(lines[i - 1]))) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        rule: "perf/array-in-loop",
        message: "Array method inside a loop",
        suggestion: "Hoist the computation outside the loop if possible",
      });
    }

    // Spread inside a loop
    if (/\.\.\./.test(line) && /\b(for|while|forEach|map|reduce)\b/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        rule: "perf/spread-in-loop",
        message: "Spread inside a loop is O(n)",
        suggestion: "Use push() or concat() to grow arrays in loops",
      });
    }

    // Sync I/O in what looks like a hot path
    if (/\b(readFileSync|writeFileSync|existsSync)\s*\(/.test(line)
        && /\b(for|while|forEach|map)\b/.test(lines[Math.max(0, i - 2)] + lines[Math.max(0, i - 1)] + lines[i])) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        rule: "perf/sync-io-in-loop",
        message: "Synchronous I/O inside a loop",
        suggestion: "Use the async variant and await in parallel where safe",
      });
    }
  }
}

// ============================================================
// OVER-ENGINEERING CHECKS — Senior dev's "does this need to exist?"
// ============================================================

function checkOverEngineering(filePath: string, content: string, issues: ReviewIssue[]): void {
  const lines = content.split("\n");
  const text = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // 1. Wrapper class with one method
  const classBodies = findBlockBodies(lines, /^\s*(export\s+)?(abstract\s+)?class\s+\w+/);
  for (const { body, nameLine, name } of classBodies) {
    const methodCount = (body.match(/^\s*(public|private|protected|static|async)?\s*\w+\s*\([^)]*\)\s*{/gm) || []).length;
    if (methodCount <= 1 && body.length > 0) {
      const trimmed = body.trim();
      const nonEmptyLines = trimmed ? trimmed.split("\n").filter(l => l.trim()).length : 0;
      if (nonEmptyLines <= 3) {
        issues.push({
          file: filePath,
          line: nameLine,
          severity: "info",
          rule: "over-engineering/wrapper-class",
          message: `Class "${name}" has only 1 method — likely a wrapper that could be a plain function`,
          suggestion: "Replace with a standalone function or a utility module export",
        });
      }
    }
  }

  // 2. Factory for one product
  const factoryMatches = text.matchAll(/^\s*(export\s+)?function\s+(create\w+|make\w+|build\w+|factory\w+)\s*\(/gm);
  for (const match of factoryMatches) {
    const funcName = match[2];
    const body = extractBodyAfter(lines, match);
    const creationCount = (body.match(/\bnew\s+\w+/g) || []).length;
    if (creationCount <= 1) {
      issues.push({
        file: filePath,
        line: lines.findIndex(l => l.includes(funcName)) + 1,
        severity: "warning",
        rule: "over-engineering/single-product-factory",
        message: `Factory "${funcName}" produces only 1 product — unnecessary abstraction`,
        suggestion: "Inline the construction or drop the factory pattern",
      });
    }
  }

  // 3. Interface with single implementation
  const interfaceNames: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(export\s+)?interface\s+(\w+)/);
    if (m) interfaceNames.push(m[2]);
  }
  for (const iface of interfaceNames) {
    const implCount = (text.match(new RegExp(`implements\\s+.*\\b${iface}\\b`, "g")) || []).length;
    if (implCount <= 1) {
      const lineNum = lines.findIndex(l => l.includes(`interface ${iface}`)) + 1;
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        rule: "over-engineering/single-impl-interface",
        message: `Interface "${iface}" has only 1 implementation — unnecessary unless more planned`,
        suggestion: "Remove the interface or inline the type",
      });
    }
  }

  // 4. Config object with values never changed
  const configObjPattern = /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*[=:]\s*\{/;
  for (let i = 0; i < lines.length; i++) {
    const cm = lines[i].match(configObjPattern);
    if (!cm || !/config|setting|option|default/i.test(cm[3])) continue;

    const configName = cm[3];
    const refs = (text.match(new RegExp(`\\b${configName}\\b`, "g")) || []).length;
    if (refs <= 2) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "info",
        rule: "over-engineering/unused-config",
        message: `Config "${configName}" is referenced ${refs === 0 ? "nowhere" : `only ${refs - 1}x outside definition`}`,
        suggestion: refs === 0
          ? "Remove the dead config"
          : "Inline the value or remove if unused elsewhere",
      });
    }
  }

  // 5. Hand-rolled implementation when stdlib covers it
  const stdlibPatterns: Array<{ pattern: RegExp; rule: string; msg: string; suggestion: string }> = [
    { pattern: /function\s+\w+\s*\([^)]*\)\s*\{[^}]*fs\.readFileSync[^}]*\}/, rule: "over-engineering/hand-rolled-file-read", msg: "Hand-rolled file reader — use fs.readFileSync directly", suggestion: "Call fs.readFileSync directly instead of wrapping" },
    { pattern: /function\s+\w+\s*\([^)]*\)\s*\{[^}]*crypto\.createHash[^}]*\}/, rule: "over-engineering/hand-rolled-hash", msg: "Hand-rolled hash — use crypto directly", suggestion: "Call crypto.createHash directly" },
    { pattern: /function\s+uuid\s*\(|function\s+generateId\s*\(/, rule: "over-engineering/hand-rolled-uuid", msg: "Hand-rolled UUID — use crypto.randomUUID()", suggestion: "Replace with crypto.randomUUID() (Node 19+) or the uuid package" },
    { pattern: /function\s+debounce\s*\(|function\s+throttle\s*\(/, rule: "over-engineering/hand-rolled-debounce", msg: "Hand-rolled debounce/throttle — utility lib or native", suggestion: "Use lodash.debounce or a 3-line inline version" },
  ];
  for (const sp of stdlibPatterns) {
    const sl = text.match(sp.pattern);
    if (sl) {
      const matchIndex = sl.index ?? 0;
      const preText = text.substring(0, matchIndex);
      const lineNum = preText.split("\n").length;
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        rule: sp.rule,
        message: sp.msg,
        suggestion: sp.suggestion,
      });
    }
  }

  // 6. Unused exports (best-effort: exported const/func referenced only once in file)
  const exportDecls: Array<{ name: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const ed = lines[i].match(/^\s*export\s+(const|let|var|function|class)\s+(\w+)/);
    if (ed) exportDecls.push({ name: ed[2], line: i + 1 });
  }
  for (const decl of exportDecls) {
    const refCount = (text.match(new RegExp(`\\b${decl.name}\\b`, "g")) || []).length;
    const isReactComponent = /^[A-Z]/.test(decl.name) && /return\s+<|React\./.test(text);
    if (refCount <= 1 && decl.name !== "default" && !isReactComponent) {
      issues.push({
        file: filePath,
        line: decl.line,
        severity: "info",
        rule: "over-engineering/unused-export",
        message: `"${decl.name}" is exported but referenced only in its declaration`,
        suggestion: "Check if it is imported elsewhere; if not, remove or inline",
      });
    }
  }
}

function findBlockBodies(lines: string[], startPattern: RegExp): Array<{ body: string; nameLine: number; name: string }> {
  const results: Array<{ body: string; nameLine: number; name: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(startPattern);
    if (!m) continue;
    const name = m[0].match(/class\s+(\w+)/)?.[1] ?? "Unknown";
    const body = collectBlockLines(lines, i);
    results.push({ body: body.join("\n"), nameLine: i + 1, name });
  }
  return results;
}

function collectBlockLines(lines: string[], startIdx: number): string[] {
  let depth = 0;
  let started = false;
  const block: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    block.push(line);
    for (const ch of line) {
      if (ch === "{") { depth++; started = true; }
      else if (ch === "}") depth--;
    }
    if (started && depth <= 0) break;
  }
  return block;
}

function extractBodyAfter(lines: string[], match: RegExpMatchArray): string {
  const startIdx = lines.findIndex(l => l.includes(match[0].trim().split(/\s+/).pop() ?? ""));
  if (startIdx < 0) return "";
  return collectBlockLines(lines, startIdx).join("\n");
}

// ============================================================
// MATCHA CONVENTIONS CHECKS
// ============================================================

function checkMatchaConventions(filePath: string, content: string, issues: ReviewIssue[]): void {
  const lines = content.split("\n");
  const text = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  for (let i = 0; i < lines.length; i++) {
    const line = stripCommentsAndStrings(lines[i]);
    const lineNum = i + 1;

    // Hardcoded values (magic numbers/strings that aren't 0, 1, or obvious)
    if (/\b(?:const|let|var)\s+\w+\s*=\s*(?:[2-9]|\d{2,})\b/.test(line)) {
      if (!/eslint-disable/.test(lines[i])) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "info",
          rule: "matcha/no-hardcoded-values",
          message: "Possible hardcoded numeric value (magic number)",
          suggestion: "Extract to a named constant",
        });
      }
    }

    // Env vars should use APPNAME_ prefix (rough check: process.env.SOMETHING)
    const envMatch = line.match(/process\.env\.([A-Z0-9_]+)/);
    if (envMatch) {
      const envName = envMatch[1];
      if (!envName.includes("_")) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          rule: "matcha/env-prefix",
          message: `Environment variable "${envName}" doesn't seem to have a prefix`,
          suggestion: "Use an APPNAME_ prefix for environment variables",
        });
      }
    }
  }

  // Abstraction without 2nd use case (similar to over-engineering single-impl)
  const interfaceNames: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(export\s+)?interface\s+(\w+)/);
    if (m) interfaceNames.push(m[2]);
  }
  for (const iface of interfaceNames) {
    const implCount = (text.match(new RegExp(`implements\\s+.*\\b${iface}\\b`, "g")) || []).length;
    if (implCount <= 1) {
      const lineNum = lines.findIndex(l => l.includes(`interface ${iface}`)) + 1;
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        rule: "matcha/no-premature-abstraction",
        message: `Interface "${iface}" has only 1 implementation — premature abstraction?`,
        suggestion: "Wait for a 2nd use case before abstracting",
      });
    }
  }
  
  // Functions doing >1 thing: long functions (>40 lines)
  const funcBodies = findBlockBodies(lines, /^\s*(export\s+)?(async\s+)?function\s+\w+/);
  for (const { body, nameLine, name } of funcBodies) {
    const nonEmptyLines = body.split("\n").filter(l => l.trim()).length;
    if (nonEmptyLines > 40) {
      issues.push({
        file: filePath,
        line: nameLine,
        severity: "warning",
        rule: "matcha/single-responsibility",
        message: `Function "${name}" is ${nonEmptyLines} lines long — might be doing >1 thing`,
        suggestion: "Extract into smaller, focused functions",
      });
    }
  }
}

// ============================================================
// FORMAT OUTPUT
// ============================================================

function formatReviewOutput(
  issues: ReviewIssue[],
  filesReviewed: number,
  totalFiles: number,
  focus: string,
  customCriteria?: string,
  autoDetected?: boolean,
): string {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  const lines: string[] = [
    `🔍 **Code Review — Focus: ${focus}**`,
    ...(focus === "over-engineering" ? ["💡 **The Ladder:** 1. Does this code need to exist? 2. Does stdlib cover it? 3. Is there a one-liner? 4. Only then, write it."] : []),
    ...(autoDetected ? [`📂 Auto-detected ${totalFiles} changed file(s) from git`] : []),
    ...(customCriteria ? [`📋 **Custom Criteria:** ${customCriteria}`] : []),
    `📁 ${filesReviewed}/${totalFiles} files reviewed`,
    `🔴 ${errors.length} errors | 🟡 ${warnings.length} warnings | 🔵 ${infos.length} info`,
    "",
  ];

  if (issues.length === 0) {
    lines.push("✅ No issues found.");
    return lines.join("\n");
  }

  const grouped = new Map<string, ReviewIssue[]>();
  for (const issue of issues) {
    const existing = grouped.get(issue.file) ?? [];
    existing.push(issue);
    grouped.set(issue.file, existing);
  }

  for (const [file, fileIssues] of grouped) {
    lines.push(`**📄 ${file}:**`);
    for (const issue of fileIssues) {
      const icon = issue.severity === "error" ? "🔴" : issue.severity === "warning" ? "🟡" : "🔵";
      lines.push(`  ${icon} [L${issue.line}] [${issue.rule}] ${issue.message}`);
      if (issue.suggestion) lines.push(`     💡 ${issue.suggestion}`);
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push("⚠️ Fix errors first, then warnings.");
    lines.push("💡 Use precise_diff_editor to apply fixes.");
  } else if (warnings.length > 0) {
    lines.push("💡 Address warnings before merging.");
  } else {
    lines.push("✅ Only informational issues — ready for testing.");
  }

  return lines.join("\n");
}
