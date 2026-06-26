import { lspClient } from "../engine/lspClient.js";
import { validateFilePath, getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";
import fs from "node:fs";
import path from "node:path";

// ============================================================
// LSP TOOLS — Semantic code analysis via TypeScript Language Server
// ============================================================

interface LSPFindParams {
  filePath: string;
  line: number;
  character: number;
}

interface LSPRenameParams {
  filePath: string;
  line: number;
  character: number;
  newName: string;
}

// ============================================================
// 1. find_references
// ============================================================

export async function handleFindReferences(params: LSPFindParams): Promise<string> {
  const { filePath, line, character } = params;

  // Validate path
  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File not found: "${filePath}".`;
  }

  // LSP unavailable — use regex fallback
  if (!lspClient.isAvailable()) {
    sessionMemory.recordToolCall("lsp_query", { action: "refs", filePath, line, character, fallback: "regex" });
    console.error(`[LSP] typescript-language-server not found. Using regex fallback for find_references.`);
    const symbolName = extractSymbolAtPosition(resolvedPath, line, character);
    if (!symbolName) {
      return `**Find References** — "${filePath}:${line + 1}:${character + 1}"
Could not read symbol at this position.

Try selecting a smaller/cleaner position, or install typescript-language-server for better results:
  npm install typescript-language-server --save-dev`;
    }
    return fallbackGrepReferences(symbolName, resolvedPath, line, character);
  }

  try {
    const references = await lspClient.findReferences(resolvedPath, line, character);

    if (references.length === 0) {
      return `**Find References** — "${filePath}:${line + 1}:${character + 1}"
No references found for symbol at this position.`;
    }

    // Read line content for each reference
    const enrichedRefs = references.map((ref) => {
      let lineContent = "";
      try {
        const content = fs.readFileSync(ref.filePath, "utf-8");
        const lines = content.split("\n");
        lineContent = lines[ref.line]?.trim() ?? "";
      } catch {
        // File might not exist or be unreadable
      }
      return { ...ref, lineContent };
    });

    // Group by file
    const grouped = new Map<string, typeof enrichedRefs>();
    for (const ref of enrichedRefs) {
      const existing = grouped.get(ref.filePath) ?? [];
      existing.push(ref);
      grouped.set(ref.filePath, existing);
    }

    const projectRoot = getProjectRoot();
    const lines: string[] = [
      `**Find References** — ${enrichedRefs.length} references found`,
      `📍 File: ${path.relative(projectRoot, resolvedPath)}:${line + 1}:${character + 1}`,
      "",
    ];

    for (const [file, refs] of grouped) {
      const relPath = path.relative(projectRoot, file);
      lines.push(`**📄 ${relPath}:**`);
      for (const ref of refs) {
        const loc = `L${ref.line + 1}:${ref.character + 1}`;
        lines.push(`  └ ${loc} — ${ref.lineContent.substring(0, 120)}`);
      }
      lines.push("");
    }

    lines.push("💡 Use smart_file_picker to read specific files.");
    return lines.join("\n");
  } catch (err) {
    return `**Find References** — error during lookup: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ============================================================
// 2. go_to_definition
// ============================================================

export async function handleGoToDefinition(params: LSPFindParams): Promise<string> {
  const { filePath, line, character } = params;

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File not found: "${filePath}".`;
  }

  // LSP unavailable — use regex fallback
  if (!lspClient.isAvailable()) {
    sessionMemory.recordToolCall("lsp_query", { action: "def", filePath, line, character, fallback: "regex" });
    console.error(`[LSP] typescript-language-server not found. Using regex fallback for go_to_definition.`);
    const symbolName = extractSymbolAtPosition(resolvedPath, line, character);
    if (!symbolName) {
      return `**Go to Definition** — "${filePath}:${line + 1}:${character + 1}"
Could not read symbol at this position.

Try selecting a smaller/cleaner position, or install typescript-language-server for better results:
  npm install typescript-language-server --save-dev`;
    }
    return fallbackGrepDefinition(symbolName);
  }

  try {
    const definition = await lspClient.goToDefinition(resolvedPath, line, character);

    if (!definition) {
      return `**Go to Definition** — "${filePath}:${line + 1}:${character + 1}"
Cannot find definition for symbol at this position.`;
    }

    const projectRoot = getProjectRoot();
    const relPath = path.relative(projectRoot, definition.filePath);

    // Read the definition line content
    let lineContent = "";
    try {
      const content = fs.readFileSync(definition.filePath, "utf-8");
      const lines = content.split("\n");
      lineContent = lines[definition.line]?.trim() ?? "";
    } catch {
      // ignore
    }

    const lines: string[] = [
      `📍 **Go to Definition**`,
      `📄 File: \`${relPath}\``,
      `📏 Line: ${definition.line + 1}:${definition.character + 1}`,
      `└ ${lineContent}`,
      "",
      `💡 Use smart_file_picker(${JSON.stringify({
        filePath: relPath,
        startLine: Math.max(1, definition.line + 1 - 5),
        endLine: definition.line + 1 + 5,
      })}) to read context around the definition.`,
    ];

    return lines.join("\n");
  } catch (err) {
    return `**Go to Definition** — error during lookup: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ============================================================
// 3. rename_symbol
// ============================================================

export async function handleRenameSymbol(params: LSPRenameParams): Promise<string> {
  const { filePath, line, character, newName } = params;

  if (!newName || newName.trim().length === 0) {
    return "Error: Parameter 'newName' must not be empty.";
  }

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File not found: "${filePath}".`;
  }

  // LSP unavailable — rename requires LSP for accurate refactoring
  if (!lspClient.isAvailable()) {
    sessionMemory.recordToolCall("lsp_query", { action: "rename", filePath, line, character, newName, fallback: "none" });
    console.error(`[LSP] typescript-language-server not found. Rename requires LSP server.`);
    return `**Rename Symbol** — cannot rename without language server.
Rename needs typescript-language-server to track references across all files.

Install: npm install typescript-language-server --save-dev

Meanwhile, use smart_grep to find all references, then precise_diff_editor to rename manually.`;
  }

  try {
    const result = await lspClient.renameSymbol(resolvedPath, line, character, newName);

    if (!result.success) {
      return `❌ **Rename Symbol** failed: ${result.error ?? "Unknown error"}
\`\`\`
Make sure:
1. Position (line: ${line + 1}, character: ${character + 1}) is exactly on the symbol you want to rename
2. The symbol is valid for renaming
\`\`\``;
    }

    if (result.changes.length === 0) {
      return "No changes needed.";
    }

    // Apply the changes to files
    const projectRoot = getProjectRoot();
    let totalEdits = 0;
    const fileChanges: Array<{ filePath: string; editCount: number }> = [];

    for (const change of result.changes) {
      try {
        const content = fs.readFileSync(change.filePath, "utf-8");
        const lines = content.split("\n");

        // Sort edits in reverse order (bottom to top) to preserve line positions
        const sortedEdits = [...change.edits].sort((a, b) => {
          if (b.line !== a.line) return b.line - a.line;
          return b.character - a.character;
        });

        for (const edit of sortedEdits) {
          const lineStr = lines[edit.line];
          if (lineStr) {
            const before = lineStr.substring(0, edit.character);
            const after = lineStr.substring(edit.endCharacter);
            lines[edit.line] = before + edit.newText + after;
          }
        }

        fs.writeFileSync(change.filePath, lines.join("\n"), "utf-8");
        totalEdits += change.edits.length;
        fileChanges.push({
          filePath: path.relative(projectRoot, change.filePath),
          editCount: change.edits.length,
        });
      } catch (err) {
        console.error(`[Rename] Failed to apply edits to ${change.filePath}: ${err}`);
      }
    }

    const lines: string[] = [
      `✏️ **Rename Symbol** ✅ Success — ${newName}`,
      `📊 ${totalEdits} changes in ${fileChanges.length} files:`,
      "",
      ...fileChanges.map((f) => `  📄 \`${f.filePath}\` — ${f.editCount} edit`),
      "",
      `💡 Run execute_safe_test({task: "typecheck"}) to verify.`,
    ];

    return lines.join("\n");
  } catch (err) {
    return `Error renaming symbol: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ============================================================
// 4. get_type_info
// ============================================================

export async function handleGetTypeInfo(params: LSPFindParams): Promise<string> {
  const { filePath, line, character } = params;

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File not found: "${filePath}".`;
  }

  // LSP unavailable — read file and show line context
  if (!lspClient.isAvailable()) {
    sessionMemory.recordToolCall("lsp_query", { action: "type", filePath, line, character, fallback: "line-context" });
    console.error(`[LSP] typescript-language-server not found. Using file-read fallback for type info.`);
    try {
      const fileContent = fs.readFileSync(resolvedPath, "utf-8");
      const fileLines = fileContent.split("\n");
      const targetLine = fileLines[line];
      if (!targetLine) {
        return `**Type Info** — Line ${line + 1} does not exist in "${filePath}".`;
      }
      const symbolName = extractSymbolAtPosition(resolvedPath, line, character);
      const projectRoot = getProjectRoot();
      const relPath = path.relative(projectRoot, resolvedPath);

      // Show context around the position (3 lines before, 3 lines after)
      const contextStart = Math.max(0, line - 3);
      const contextEnd = Math.min(fileLines.length, line + 4);
      const contextLines: string[] = [];
      for (let i = contextStart; i < contextEnd; i++) {
        const prefix = i === line ? "→" : " ";
        const marker = i === line && symbolName ? " ".repeat(character) + "^".repeat(Math.min(symbolName.length, 20)) : "";
        contextLines.push(`${prefix} L${i + 1}: ${fileLines[i].replace(/\t/g, " ")}`);
        if (marker) {
          contextLines.push(`  ${marker}`);
        }
      }

      const resultLines: string[] = [
        `📋 **Type Info** — \`${relPath}:${line + 1}:${character + 1}\``,
        symbolName ? `🔤 **Symbol:** \`${symbolName}\`` : `Could not extract symbol at this position.`,
        "",
        "📎 Context:",
        "```",
        ...contextLines,
        "```",
        "",
        "Use smart_grep or smart_file_picker to read more context.",
      ];

      return resultLines.join("\n");
    } catch (err) {
      return `**Type Info** — could not read file for context: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  try {
    const hoverInfo = await lspClient.getTypeInfo(resolvedPath, line, character);

    if (!hoverInfo || !hoverInfo.contents) {
      return `**Type Info** — "${filePath}:${line + 1}:${character + 1}"
No type info for this position.`;
    }

    const projectRoot = getProjectRoot();
    const relPath = path.relative(projectRoot, resolvedPath);

    const lines: string[] = [
      `📋 **Type Info** — \`${relPath}:${line + 1}:${character + 1}\``,
      "",
      "```typescript",
      hoverInfo.contents,
      "```",
    ];

    if (hoverInfo.range) {
      const r = hoverInfo.range;
      lines.push(
        "",
        `📍 Range: L${r.start.line + 1}:${r.start.character + 1} — L${r.end.line + 1}:${r.end.character + 1}`,
      );
    }

    return lines.join("\n");
  } catch (err) {
    return `Error getting type info: ${err instanceof Error ? err.message : String(err)}`;
  }
}

interface LSPQueryParams {
  filePath: string;
  line: number;
  character: number;
  action: "def" | "refs" | "type" | "rename";
  newName?: string;
}

export async function handleLspQuery(params: LSPQueryParams): Promise<string> {
  const { filePath, line, character, action, newName } = params;
  if (action === "def") {
    return handleGoToDefinition({ filePath, line, character });
  }
  if (action === "refs") {
    return handleFindReferences({ filePath, line, character });
  }
  if (action === "type") {
    return handleGetTypeInfo({ filePath, line, character });
  }
  if (action === "rename") {
    if (!newName || newName.trim().length === 0) {
      return "Error: Parameter 'newName' required for rename action.";
    }
    return handleRenameSymbol({ filePath, line, character, newName });
  }
  return `Error: Action "${action}" not supported.`;
}

// ============================================================
// LSP FALLBACK: Regex-based helpers when LSP server is unavailable
// ============================================================

/** Read symbol name at position using simple regex */
function extractSymbolAtPosition(filePath: string, line: number, character: number): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const targetLine = lines[line];
    if (!targetLine) return null;

    // Find word around character position
    const before = targetLine.slice(0, character);
    const after = targetLine.slice(character);
    const leftMatch = before.match(/(\w+)$/);
    const rightMatch = after.match(/^(\w+)/);
    const left = leftMatch ? leftMatch[1] : "";
    const right = rightMatch ? rightMatch[1] : "";
    const symbol = left + right;
    return symbol.length > 0 ? symbol : null;
  } catch {
    return null;
  }
}

/** Fallback grep for find references */
async function fallbackGrepReferences(symbolName: string, _filePath: string, _line: number, _character: number): Promise<string> {
  try {
    const { default: fg } = await import("fast-glob");
    const root = getProjectRoot();
    const tsFiles = await fg(["**/*.{ts,tsx,js,jsx}"], {
      cwd: root,
      ignore: ["node_modules/**", "dist/**", ".git/**"],
      onlyFiles: true,
      absolute: true,
    });

    const results: Array<{ file: string; line: number; content: string }> = [];
    const escapedSymbol = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedSymbol}\\b`, "g");

    for (const file of tsFiles.slice(0, 100)) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push({ file, line: i + 1, content: lines[i].trim().substring(0, 120) });
          }
        }
        if (results.length >= 50) break;
      } catch {
        continue;
      }
    }

    if (results.length === 0) {
      return `**Find References** — "${symbolName}"
No references found. Symbol may not be used in other files.`;
    }

    const grouped = new Map<string, typeof results>();
    for (const r of results) {
      const existing = grouped.get(r.file) ?? [];
      existing.push(r);
      grouped.set(r.file, existing);
    }

    const projectRoot = getProjectRoot();
    const lines: string[] = [
      `**Find References** — ${results.length} references found`,
      `📍 Symbol: "${symbolName}"`,
      "",
    ];

    // Warn about ambiguity when matches span multiple files or appear in different scopes
    if (grouped.size > 1) {
      const fileList = [...grouped.keys()].map(f => path.relative(projectRoot, f)).join(", ");
      lines.push(`**Ambiguity note:** Found matches across ${grouped.size} different files (${fileList}).`);
      lines.push(`   Verify each match is the right scope — results may include same-named symbols.`);
      lines.push("");
    } else if (results.length > 1) {
      // Single file, multiple matches — could still be different scopes (different functions)
      const filePath = [...grouped.keys()][0];
      const refs = grouped.get(filePath)!;
      // Check if matches span more than 15 lines apart (likely different scopes)
      const matchLines = refs.map(r => r.line);
      const minLine = Math.min(...matchLines);
      const maxLine = Math.max(...matchLines);
      if (maxLine - minLine > 15) {
        lines.push(`**Ambiguity note:** Found ${results.length} matches for "${symbolName}" spanning lines ${minLine}-${maxLine} in the same file.`);
        lines.push(`   Verify each match is the intended symbol.`);
        lines.push("");
      }
    }

    for (const [file, refs] of grouped) {
      const relPath = path.relative(projectRoot, file);
      lines.push(`**📄 ${relPath}:**`);
      for (const ref of refs) {
        lines.push(`  └ L${ref.line} — ${ref.content}`);
      }
      lines.push("");
    }

    console.error(`[LSP] Regex fallback: found ${results.length} references for "${symbolName}".`);
    return lines.join("\n");
  } catch (err) {
    return `Error in fallback grep references: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Fallback regex for go to definition */
async function fallbackGrepDefinition(symbolName: string): Promise<string> {
  try {
    const { default: fg } = await import("fast-glob");
    const root = getProjectRoot();
    const tsFiles = await fg(["**/*.{ts,tsx,js,jsx}"], {
      cwd: root,
      ignore: ["node_modules/**", "dist/**", ".git/**"],
      onlyFiles: true,
      absolute: true,
    });

    const escapedSymbol = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declPatterns = [
      new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${escapedSymbol}\\b`),
      new RegExp(`^(export\\s+)?(default\\s+)?(abstract\\s+)?class\\s+${escapedSymbol}\\b`),
      new RegExp(`^(export\\s+)?interface\\s+${escapedSymbol}\\b`),
      new RegExp(`^(export\\s+)?type\\s+${escapedSymbol}\\b`),
      new RegExp(`^(export\\s+)?(const|let|var)\\s+${escapedSymbol}\\b`),
      new RegExp(`^(export\\s+)?enum\\s+${escapedSymbol}\\b`),
    ];

    for (const file of tsFiles) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const trimmed = lines[i].trim();
          for (const pattern of declPatterns) {
            if (pattern.test(trimmed)) {
              const projectRoot = getProjectRoot();
              const relPath = path.relative(projectRoot, file);
              return [
                `📍 **Go to Definition**`,
                `📄 File: \`${relPath}\``,
                `📏 Line: ${i + 1}`,
                `└ ${trimmed.substring(0, 120)}`,
              ].join("\n");
            }
          }
        }
      } catch {
        continue;
      }
    }
    console.error(`[LSP] Regex fallback: no definition found for "${symbolName}".`);
    return `**Go to Definition** — "${symbolName}"
Cannot find definition.`;
  } catch (err) {
    return `Error in fallback grep definition: ${err instanceof Error ? err.message : String(err)}`;
  }
}
