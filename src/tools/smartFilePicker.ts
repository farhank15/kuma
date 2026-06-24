import fs from "node:fs";
import path from "node:path";
import { validateFilePath, getProjectRoot } from "../utils/pathValidator.js";
import { truncateToTokenLimit } from "../utils/tokenCounter.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// SMART FILE PICKER — File reader with smart chunking
// ============================================================

interface SmartFilePickerParams {
  filePath: string;
  startLine?: number;
  endLine?: number;
  chunkStrategy?: "full" | "smart" | "outline";
}

const MAX_FILE_SIZE = 1_000_000; // 1MB
const CHUNK_THRESHOLD = 300; // lines

export async function handleSmartFilePicker(
  params: SmartFilePickerParams,
): Promise<string> {
  const { filePath, startLine, endLine, chunkStrategy = "smart" } = params;

  // Path validation
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return "Error: " + validation.error.message;
  }

  const resolvedPath = validation.resolvedPath;

  // Check file exists
  if (!fs.existsSync(resolvedPath)) {
    const projectRoot = getProjectRoot();

    let suggestion: string;
    if (!path.isAbsolute(filePath)) {
      const cwdPath = path.resolve(process.cwd(), filePath);
      suggestion =
        "Path resolved to: " +
        resolvedPath +
        "\n" +
        "CWD: " +
        process.cwd() +
        "\n" +
        "Project root: " +
        projectRoot +
        "\n" +
        "Hint: Try path relative to project root, or relative to CWD (" +
        cwdPath +
        ")\n" +
        "Try smart_grep first to locate the correct file.";
    } else {
      suggestion = "File does not exist. Try smart_grep to locate it.";
    }

    return 'Error: File not found: "' + filePath + '".\n' + suggestion;
  }

  const stat = fs.statSync(resolvedPath);

  // Check file size
  if (stat.size > MAX_FILE_SIZE) {
    return (
      "Error: File too large (" +
      (stat.size / 1024 / 1024).toFixed(1) +
      "MB). Max 1MB.\n" +
      "Use smart_grep to find specific content instead."
    );
  }

  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    sessionMemory.recordToolCall("smart_file_picker", {
      filePath,
      chunkStrategy,
      totalLines,
    });

    // Explicit range
    if (startLine !== undefined || endLine !== undefined) {
      const start = startLine ?? 1;
      const end = endLine ?? totalLines;
      const selectedLines = lines.slice(start - 1, end);
      return formatOutput(filePath, selectedLines, start, totalLines, false);
    }

    // Small file: send full
    if (totalLines <= CHUNK_THRESHOLD || chunkStrategy === "full") {
      return formatOutput(filePath, lines, 1, totalLines, false);
    }

    // Chunking strategy
    switch (chunkStrategy) {
      case "outline":
        return handleOutlineStrategy(filePath, lines, totalLines);
      case "smart":
        return handleSmartStrategy(filePath, lines, totalLines);
      default:
        return formatOutput(
          filePath,
          lines.slice(0, CHUNK_THRESHOLD),
          1,
          totalLines,
          true,
        );
    }
  } catch (err) {
    return (
      'Error reading file "' +
      filePath +
      '": ' +
      (err instanceof Error ? err.message : String(err))
    );
  }
}

function formatOutput(
  filePath: string,
  lines: string[],
  startLine: number,
  totalLines: number,
  truncated: boolean,
): string {
  const header = [
    "File: " + filePath,
    totalLines + " total lines",
    truncated
      ? "Showing " +
        lines.length +
        " lines (file >" +
        CHUNK_THRESHOLD +
        " lines). Use startLine/endLine for a specific range."
      : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = lines
    .map((line, i) => {
      const lineNum = startLine + i;
      return String(lineNum).padStart(4, " ") + " | " + line;
    })
    .join("\n");

  const full = header + "\n" + body;

  // Limit total output (anti token explosion)
  return truncateToTokenLimit(full, 2000);
}

async function handleOutlineStrategy(
  filePath: string,
  lines: string[],
  totalLines: number,
): Promise<string> {
  // Outline: only imports + exported symbols
  const importLines: string[] = [];
  const exportLines: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip comments
    if (
      line.startsWith("//") ||
      line.startsWith("#") ||
      line.startsWith("/*") ||
      line.startsWith("*")
    )
      continue;

    // Imports
    if (
      line.startsWith("import ") ||
      line.startsWith("from ") ||
      line.startsWith("require(")
    ) {
      importLines.push(line);
      continue;
    }

    // Exports and declarations
    if (
      line.startsWith("export ") ||
      line.startsWith("function ") ||
      line.startsWith("const ") ||
      line.startsWith("let ") ||
      line.startsWith("var ") ||
      line.startsWith("class ") ||
      line.startsWith("interface ") ||
      line.startsWith("type ") ||
      line.startsWith("enum ") ||
      line.startsWith("def ") ||
      line.startsWith("async function ") ||
      line.startsWith("async def ")
    ) {
      exportLines.push({ line: i + 1, text: line.substring(0, 150) });
    }
  }

  const result = [
    "File: " + filePath,
    totalLines + " total lines (OUTLINE MODE - signatures and imports only)",
    "",
    "Imports:",
    ...importLines.slice(0, 30).map((l) => "  " + l.substring(0, 150)),
    importLines.length > 30
      ? "  ...and " + (importLines.length - 30) + " more imports"
      : "",
    "",
    "Exports & Declarations:",
    ...exportLines.map((e) => "  [L" + e.line + "] " + e.text),
    "",
    "Pass startLine/endLine to read a specific range.",
    'Or use chunkStrategy: "full" to read the entire file.',
  ]
    .filter(Boolean)
    .join("\n");

  return truncateToTokenLimit(result, 1500);
}

async function handleSmartStrategy(
  filePath: string,
  lines: string[],
  totalLines: number,
): Promise<string> {
  // Smart: send header (imports) + key signatures + tail
  // Gives the model enough context without overloading tokens

  const headerEnd = Math.min(findHeaderEnd(lines), 50);
  const tailStart = Math.max(totalLines - 30, headerEnd);

  const smartLines: Array<{ line: number; text: string }> = [];

  // Header (imports, early interfaces)
  for (let i = 0; i < headerEnd; i++) {
    smartLines.push({ line: i + 1, text: lines[i] });
  }

  // Function/class signatures from the middle
  if (headerEnd < tailStart) {
    smartLines.push({ line: -1, text: "" });
    smartLines.push({
      line: -1,
      text: "  ... " + (tailStart - headerEnd) + " lines hidden ...",
    });
    smartLines.push({ line: -1, text: "" });
  }

  // Key declarations
  const keyDeclarations = extractKeyDeclarations(
    lines.slice(headerEnd, tailStart),
  );
  for (const decl of keyDeclarations) {
    smartLines.push({ line: decl.line + 1 + headerEnd, text: decl.text });
  }

  if (keyDeclarations.length > 0 && headerEnd < tailStart) {
    smartLines.push({ line: -1, text: "" });
  }

  // Tail (last 30 lines)
  for (let i = tailStart; i < totalLines; i++) {
    smartLines.push({ line: i + 1, text: lines[i] });
  }

  const header = [
    "File: " + filePath,
    totalLines + " total lines (SMART MODE - header + signatures + tail)",
    "Pass startLine/endLine to read a specific range.",
    'Or use chunkStrategy: "full" to read the entire file.',
    "",
  ].join("\n");

  const body = smartLines
    .map((s) => {
      if (s.line === -1) return s.text;
      return String(s.line).padStart(4, " ") + " | " + s.text;
    })
    .join("\n");

  const full = header + "\n" + body;
  return truncateToTokenLimit(full, 3000);
}

function findHeaderEnd(lines: string[]): number {
  // Find the end of the imports/header block
  let lastImportLine = 0;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const line = lines[i].trim();
    if (
      line.startsWith("import ") ||
      line.startsWith("from ") ||
      line.startsWith("require(") ||
      line.startsWith("//") ||
      line.startsWith("#") ||
      line.startsWith("/*") ||
      line.startsWith("*") ||
      line === ""
    ) {
      if (
        !line.startsWith("//") &&
        !line.startsWith("#") &&
        !line.startsWith("/*") &&
        !line.startsWith("*") &&
        line !== ""
      ) {
        lastImportLine = i;
      }
    } else {
      // If we've passed imports and hit code, stop
      if (lastImportLine > 0) break;
    }
  }
  return Math.max(lastImportLine + 1, 10);
}

function extractKeyDeclarations(
  lines: string[],
): Array<{ line: number; text: string }> {
  const decls: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty/comments
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    // Match function/class/interface/exports declarations
    if (
      /^(export\s+)?(async\s+)?(function|class|interface|type|enum|const|let|var|def)\s/.test(
        line,
      )
    ) {
      decls.push({ line: i, text: line.substring(0, 150) });
    }
  }

  return decls;
}
