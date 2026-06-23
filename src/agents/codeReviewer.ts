import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { validateFilePath, getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// CODE REVIEWER — Agent khusus untuk me-review kode
// ============================================================

interface CodeReviewerParams {
  files?: string[];
  focus?: "correctness" | "conventions" | "security" | "performance";
  customCriteria?: string;
  format?: "text" | "json";
}

interface ReviewIssue {
  file: string;
  line: number;
  severity: "error" | "warning" | "info";
  message: string;
  suggestion: string;
}

function getGitChangedFiles(): string[] {
  try {
    const root = getProjectRoot();
    const stdout = execSync("git status --porcelain", {
      cwd: root,
      encoding: "utf-8",
    });
    const lines = stdout.split("\n");
    const files: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // git status porcelain output is: XY path/to/file or XY "path/to/file"
      const parts = trimmed.split(/\s+/);
      let filePath = parts.slice(1).join(" ");
      if (filePath.startsWith('"') && filePath.endsWith('"')) {
        filePath = filePath.substring(1, filePath.length - 1);
      }
      const ext = path.extname(filePath).toLowerCase();
      // Filter only coding files to avoid reviewing lock files or images
      if (
        [
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".py",
          ".go",
          ".rs",
          ".php",
          ".cs",
          ".java",
        ].includes(ext)
      ) {
        files.push(filePath);
      }
    }
    return files.slice(0, 10); // Limit to max 10 files
  } catch (err) {
    console.error(
      `[CodeReviewer] Gagal mendapatkan list file dari git status: ${err}`,
    );
    return [];
  }
}

export async function handleCodeReviewer(
  params: CodeReviewerParams,
): Promise<string> {
  const { files: inputFiles, focus = "correctness", customCriteria, format = "text" } = params;

  let files = inputFiles ?? [];
  let isAutoDetected = false;

  if (files.length === 0) {
    files = getGitChangedFiles();
    isAutoDetected = true;
    if (files.length === 0) {
      return `ℹ️ Tidak ada file kode (TS/JS/Python/Go) yang terdeteksi berubah di git diff saat ini.\nSilakan masukkan file yang ingin di-review secara manual menggunakan parameter 'files'.`;
    }
  }

  const allIssues: ReviewIssue[] = [];
  let filesReviewed = 0;

  for (const filePath of files) {
    // Validate path
    const validation = validateFilePath(filePath);
    if (!validation.valid) {
      allIssues.push({
        file: filePath,
        line: 0,
        severity: "error",
        message: `Invalid path: ${validation.error.message}`,
        suggestion: "Perbaiki path file",
      });
      continue;
    }

    const resolvedPath = validation.resolvedPath;
    if (!fs.existsSync(resolvedPath)) {
      allIssues.push({
        file: filePath,
        line: 0,
        severity: "error",
        message: "File not found",
        suggestion: "Cek apakah file sudah benar pathnya",
      });
      continue;
    }

    try {
      const content = fs.readFileSync(resolvedPath, "utf-8");
      filesReviewed++;

      // Review berdasarkan focus
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
      }
    } catch (err) {
      allIssues.push({
        file: filePath,
        line: 0,
        severity: "error",
        message: `Error reading file: ${err}`,
        suggestion: "",
      });
    }
  }

  // Record ke session
  sessionMemory.recordToolCall("code_reviewer", {
    filesReviewed,
    focus,
    issuesFound: allIssues.length,
    errors: allIssues.filter((i) => i.severity === "error").length,
  });

  if (format === "json") {
    return JSON.stringify(allIssues, null, 2);
  }

  return formatReviewOutput(
    allIssues,
    filesReviewed,
    files.length,
    focus,
    customCriteria,
  );
}

// ============================================================
// REVIEW CHECKS
// ============================================================

function checkCorrectness(
  filePath: string,
  content: string,
  issues: ReviewIssue[],
): void {
  const lines = content.split("\n");
  const ext = path.extname(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check: console.log left in code
    if (
      /console\.(log|debug|info)\(/.test(line) &&
      !filePath.includes(".test.")
    ) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        message: "Leftover console.log statement",
        suggestion: "Hapus atau ganti dengan structured logging",
      });
    }

    // Check: TODO/FIXME comments
    if (
      /\b(TODO|FIXME|HACK|XXX)\b/i.test(line) &&
      !line.includes("// TODO:") &&
      !line.includes("// FIXME:")
    ) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        message: "Unresolved TODO/FIXME",
        suggestion: "Selesaikan atau buat issue tracker",
      });
    }

    // TypeScript specific checks
    if (ext === ".ts" || ext === ".tsx") {
      // Check: 'any' type usage
      if (/: any\b/.test(line) && !line.includes("// eslint-disable")) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "error",
          message: "Usage of 'any' type detected",
          suggestion: "Ganti 'any' dengan tipe yang spesifik atau 'unknown'",
        });
      }

      // Check: @ts-ignore
      if (/@ts-ignore/.test(line)) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          message: "@ts-ignore suppresses type errors",
          suggestion: "Gunakan @ts-expect-error dengan alasan yang jelas",
        });
      }
    }

    // Check: empty catch blocks
    if (/catch\s*\([^)]*\)\s*{[\s]*}/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "error",
        message: "Empty catch block swallows errors",
        suggestion:
          "Tambahkan error handling minimal: console.error atau throw",
      });
    }

    // Check: hardcoded secrets
    if (
      /(password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]+['"]/i.test(line)
    ) {
      if (!line.includes("process.env") && !line.includes("import.meta.env")) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "error",
          message: "Potential hardcoded secret detected",
          suggestion: "Gunakan environment variable: process.env.YOUR_VAR",
        });
      }
    }
  }

  // Check: file ends with newline
  if (!content.endsWith("\n")) {
    issues.push({
      file: filePath,
      line: lines.length,
      severity: "info",
      message: "File does not end with newline",
      suggestion: "Tambahkan newline di akhir file",
    });
  }
}

function checkConventions(
  filePath: string,
  content: string,
  issues: ReviewIssue[],
): void {
  const lines = content.split("\n");

  // Check: mixed indentation
  let hasTabs = false;
  let hasSpaces = false;

  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (lines[i].startsWith("\t")) hasTabs = true;
    if (lines[i].startsWith("  ") || lines[i].startsWith("    "))
      hasSpaces = true;
  }

  if (hasTabs && hasSpaces) {
    issues.push({
      file: filePath,
      line: 1,
      severity: "warning",
      message: "Mixed indentation (tabs and spaces)",
      suggestion:
        "Konsisten: pilih tabs atau spaces (prefer 2 spaces untuk JS/TS)",
    });
  }

  // Check: line length
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 200) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "info",
        message: `Line too long (${lines[i].length} chars)`,
        suggestion: "Pertimbangkan untuk memecah baris > 200 karakter",
      });
      break; // Only report once
    }
  }

  // Check: naming conventions
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Classes should be PascalCase
    const classMatch = line.match(/class\s+([a-zA-Z_$][\w$]*)/);
    if (classMatch && !/^[A-Z]/.test(classMatch[1])) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "warning",
        message: `Class "${classMatch[1]}" should be PascalCase`,
        suggestion: `Rename to "${classMatch[1].charAt(0).toUpperCase() + classMatch[1].slice(1)}"`,
      });
    }

    // Functions should be camelCase
    const funcMatch = line.match(/function\s+([A-Z][a-zA-Z0-9_$]*)\s*\(/);
    if (funcMatch && !line.includes("React") && !line.includes("Component")) {
      issues.push({
        file: filePath,
        line: i + 1,
        severity: "info",
        message: `Function "${funcMatch[1]}" starts with uppercase (may be a component?)`,
        suggestion: "Gunakan lowercase untuk regular functions",
      });
    }
  }
}

function checkSecurity(
  filePath: string,
  content: string,
  issues: ReviewIssue[],
): void {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check: eval()
    if (/\beval\s*\(/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "error",
        message: "eval() is a security risk",
        suggestion:
          "Hindari eval(). Gunakan JSON.parse() atau Function constructor",
      });
    }

    // Check: innerHTML
    if (/\.innerHTML\s*=/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        message: "innerHTML can lead to XSS",
        suggestion: "Gunakan textContent atau DOMPurify untuk sanitasi",
      });
    }

    // Check: SQL injection potential
    if (/\.query\s*\([\s`'"]+SELECT|INSERT|UPDATE|DELETE/.test(line)) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "warning",
        message: "Raw SQL query detected — potential SQL injection",
        suggestion: "Gunakan prepared statements atau ORM query builder",
      });
    }

    // Check: shell command injection
    if (/exec\(|execSync\(|spawn\(|spawnSync\(/.test(line)) {
      if (!line.includes("// approved") && !line.includes("sanitize")) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          message: "Shell command execution detected",
          suggestion:
            "Sanitize input dan gunakan execa dengan options yang aman",
        });
      }
    }
  }
}

function checkPerformance(
  filePath: string,
  content: string,
  issues: ReviewIssue[],
): void {
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check: nested loops
    if (/(for\s*\(|while\s*\()/.test(line)) {
      // Check if previous/next lines also have loops
      if (i > 0 && /(for\s*\(|while\s*\()/.test(lines[i - 1])) {
        issues.push({
          file: filePath,
          line: lineNum,
          severity: "warning",
          message: "Nested loops detected — potential O(n²) performance issue",
          suggestion:
            "Pertimbangkan menggunakan Map/Set atau algoritma yang lebih efisien",
        });
      }
    }

    // Check: large array operations in loop
    if (/\.filter\(/.test(line) && i > 0 && /for\s*\(/.test(lines[i - 1])) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        message: "Array method inside loop — consider moving outside",
        suggestion:
          "Pindahkan operasi array ke luar loop untuk performa lebih baik",
      });
    }

    // Check: unnecessary spread in loops
    if (/\.\.\./.test(line) && /(for|while|forEach|map)/.test(lines[i])) {
      issues.push({
        file: filePath,
        line: lineNum,
        severity: "info",
        message: "Spread operator in loop can be expensive",
        suggestion: "Pertimbangkan untuk menggunakan push() atau concat()",
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
): string {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const infos = issues.filter((i) => i.severity === "info");

  const lines: string[] = [
    `🔍 **Code Review — Focus: ${focus}**`,
    ...(customCriteria ? [`📋 **Custom Criteria:** ${customCriteria}`] : []),
    `📁 ${filesReviewed}/${totalFiles} files reviewed`,
    `🔴 ${errors.length} errors | 🟡 ${warnings.length} warnings | 🔵 ${infos.length} info`,
    "",
  ];

  if (issues.length === 0) {
    lines.push("✅ No issues found! Code looks clean.");
    return lines.join("\n");
  }

  // Group by file
  const grouped = new Map<string, ReviewIssue[]>();
  for (const issue of issues) {
    const existing = grouped.get(issue.file) ?? [];
    existing.push(issue);
    grouped.set(issue.file, existing);
  }

  for (const [file, fileIssues] of grouped) {
    lines.push(`**📄 ${file}:**`);
    for (const issue of fileIssues) {
      const icon =
        issue.severity === "error"
          ? "🔴"
          : issue.severity === "warning"
            ? "🟡"
            : "🔵";
      lines.push(`  ${icon} [L${issue.line}] ${issue.message}`);
      if (issue.suggestion) {
        lines.push(`     💡 ${issue.suggestion}`);
      }
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push(
      "⚠️ **Prioritas: Fix error issues terlebih dahulu, lalu warning.**",
    );
    lines.push(
      "💡 Gunakan precise_diff_editor untuk memperbaiki issues di atas.",
    );
  } else if (warnings.length > 0) {
    lines.push("💡 Pertimbangkan untuk memperbaiki warnings sebelum lanjut.");
  } else {
    lines.push("✅ Issues minor. Siap untuk lanjut ke testing.");
  }

  return lines.join("\n");
}
