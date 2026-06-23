import { lspClient } from "../engine/lspClient.js";
import { validateFilePath, getProjectRoot } from "../utils/pathValidator.js";
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
    return `Error: File tidak ditemukan: "${filePath}".`;
  }

  try {
    const references = await lspClient.findReferences(resolvedPath, line, character);

    if (references.length === 0) {
      return `🔍 **Find References** — "${filePath}:${line + 1}:${character + 1}"\n⚠️ Tidak ada referensi ditemukan untuk symbol di posisi ini.`;
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
      `🔍 **Find References** — ${enrichedRefs.length} referensi ditemukan`,
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

    lines.push("💡 Gunakan smart_file_picker untuk membaca file spesifik.");
    return lines.join("\n");
  } catch (err) {
    return `Error saat mencari referensi: ${err instanceof Error ? err.message : String(err)}`;
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
    return `Error: File tidak ditemukan: "${filePath}".`;
  }

  try {
    const definition = await lspClient.goToDefinition(resolvedPath, line, character);

    if (!definition) {
      return `🔍 **Go to Definition** — "${filePath}:${line + 1}:${character + 1}"\n⚠️ Tidak dapat menemukan definisi untuk symbol di posisi ini.`;
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
      `💡 Gunakan smart_file_picker(${JSON.stringify({
        filePath: relPath,
        startLine: Math.max(1, definition.line + 1 - 5),
        endLine: definition.line + 1 + 5,
      })}) untuk membaca konteks sekitar definisi.`,
    ];

    return lines.join("\n");
  } catch (err) {
    return `Error saat mencari definisi: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ============================================================
// 3. rename_symbol
// ============================================================

export async function handleRenameSymbol(params: LSPRenameParams): Promise<string> {
  const { filePath, line, character, newName } = params;

  if (!newName || newName.trim().length === 0) {
    return "Error: Parameter 'newName' tidak boleh kosong.";
  }

  const validation = validateFilePath(filePath);
  if (!validation.valid) {
    return `Error: ${validation.error.message}`;
  }

  const resolvedPath = validation.resolvedPath;
  if (!fs.existsSync(resolvedPath)) {
    return `Error: File tidak ditemukan: "${filePath}".`;
  }

  try {
    const result = await lspClient.renameSymbol(resolvedPath, line, character, newName);

    if (!result.success) {
      return `❌ **Rename Symbol** gagal: ${result.error ?? "Unknown error"}
\`\`\`
Pastikan:
1. Posisi (line: ${line + 1}, character: ${character + 1}) tepat pada symbol yang ingin di-rename
2. Symbol tersebut valid untuk di-rename
\`\`\``;
    }

    if (result.changes.length === 0) {
      return "⚠️ Tidak ada perubahan yang diperlukan.";
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
      `✏️ **Rename Symbol** ✅ Berhasil — ${newName}`,
      `📊 ${totalEdits} perubahan di ${fileChanges.length} file:`,
      "",
      ...fileChanges.map((f) => `  📄 \`${f.filePath}\` — ${f.editCount} edit`),
      "",
      `💡 Jalankan execute_safe_test({task: "typecheck"}) untuk verifikasi.`,
    ];

    return lines.join("\n");
  } catch (err) {
    return `Error saat rename symbol: ${err instanceof Error ? err.message : String(err)}`;
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
    return `Error: File tidak ditemukan: "${filePath}".`;
  }

  try {
    const hoverInfo = await lspClient.getTypeInfo(resolvedPath, line, character);

    if (!hoverInfo || !hoverInfo.contents) {
      return `📋 **Type Info** — "${filePath}:${line + 1}:${character + 1}"
⚠️ Tidak ada informasi tipe untuk posisi ini.`;
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
        `📍 Cakupan: L${r.start.line + 1}:${r.start.character + 1} — L${r.end.line + 1}:${r.end.character + 1}`,
      );
    }

    return lines.join("\n");
  } catch (err) {
    return `Error saat mengambil type info: ${err instanceof Error ? err.message : String(err)}`;
  }
}

interface LSPQueryParams {
  filePath: string;
  line: number;
  character: number;
  action: "def" | "refs" | "type";
}

export async function handleLspQuery(params: LSPQueryParams): Promise<string> {
  const { filePath, line, character, action } = params;
  if (action === "def") {
    return handleGoToDefinition({ filePath, line, character });
  }
  if (action === "refs") {
    return handleFindReferences({ filePath, line, character });
  }
  if (action === "type") {
    return handleGetTypeInfo({ filePath, line, character });
  }
  return `Error: Action "${action}" tidak didukung.`;
}

