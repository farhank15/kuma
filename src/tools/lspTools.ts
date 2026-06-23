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

  // LSP fallback ke regex grep
  if (!lspClient.isAvailable()) {
    const symbolName = extractSymbolAtPosition(resolvedPath, line, character);
    if (!symbolName) {
      return `⚠️ LSP tidak tersedia dan tidak bisa membaca symbol di posisi tersebut untuk fallback grep.

💡 Install typescript-language-server: npm install typescript-language-server --save-dev`;
    }
    return fallbackGrepReferences(symbolName, resolvedPath, line, character);
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

  // LSP fallback ke regex
  if (!lspClient.isAvailable()) {
    const symbolName = extractSymbolAtPosition(resolvedPath, line, character);
    if (!symbolName) {
      return `⚠️ LSP tidak tersedia dan tidak bisa membaca symbol di posisi tersebut untuk fallback.

💡 Install typescript-language-server: npm install typescript-language-server --save-dev`;
    }
    return fallbackGrepDefinition(symbolName);
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

  // LSP fallback: rename butuh LSP server untuk refactoring akurat
  if (!lspClient.isAvailable()) {
    return `⚠️ **Rename Symbol** tidak tersedia tanpa LSP server.
Rename membutuhkan typescript-language-server untuk tracking referensi di semua file.
💡 Install: npm install typescript-language-server --save-dev

Sementara, gunakan smart_grep dulu untuk cari semua referensi, lalu precise_diff_editor untuk edit manual.`;
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

  // LSP fallback: type info butuh LSP server
  if (!lspClient.isAvailable()) {
    return `⚠️ **Type Info** tidak tersedia tanpa LSP server.

Type info membutuhkan typescript-language-server untuk analisis semantik.
💡 Install: npm install typescript-language-server --save-dev

Sementara, gunakan smart_grep atau baca file langsung untuk memahami struktur kode.`;
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

// ============================================================
// LSP FALLBACK: Regex-based helpers saat LSP server unavailable
// ============================================================

/** Baca symbol name di posisi tertentu pake regex sederhana */
function extractSymbolAtPosition(filePath: string, line: number, character: number): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const targetLine = lines[line];
    if (!targetLine) return null;

    // Cari word di sekitar character position
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

/** Fallback grep untuk find references */
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
      return `🔍 **Find References** (regex fallback) — "${symbolName}"
⚠️ Tidak ada referensi ditemukan. Mungkin symbol tidak digunakan di file lain.`;
    }

    const grouped = new Map<string, typeof results>();
    for (const r of results) {
      const existing = grouped.get(r.file) ?? [];
      existing.push(r);
      grouped.set(r.file, existing);
    }

    const projectRoot = getProjectRoot();
    const lines: string[] = [
      `🔍 **Find References** (regex fallback) — ${results.length} referensi ditemukan`,
      `📍 Symbol: "${symbolName}"`,
      `⚠️ Hasil regex mungkin kurang akurat dibanding LSP (termasuk komentar/string).`,
      "",
    ];

    for (const [file, refs] of grouped) {
      const relPath = path.relative(projectRoot, file);
      lines.push(`**📄 ${relPath}:**`);
      for (const ref of refs) {
        lines.push(`  └ L${ref.line} — ${ref.content}`);
      }
      lines.push("");
    }

    lines.push("💡 Install typescript-language-server untuk hasil yang lebih akurat.");
    return lines.join("\n");
  } catch (err) {
    return `Error saat fallback grep references: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Fallback regex untuk go to definition */
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
                `📍 **Go to Definition** (regex fallback)`,
                `📄 File: \`${relPath}\``,
                `📏 Line: ${i + 1}`,
                `└ ${trimmed.substring(0, 120)}`,
                "",
                `💡 Install typescript-language-server untuk hasil yang lebih akurat.`,
              ].join("\n");
            }
          }
        }
      } catch {
        continue;
      }
    }

    return `📍 **Go to Definition** (regex fallback) — "${symbolName}"
⚠️ Tidak dapat menemukan definisi.
💡 Install typescript-language-server untuk hasil yang lebih akurat.`;
  } catch (err) {
    return `Error saat fallback grep definition: ${err instanceof Error ? err.message : String(err)}`;
  }
}

