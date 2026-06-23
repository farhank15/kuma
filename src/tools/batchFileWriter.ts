import fs from "node:fs";
import path from "node:path";
import { validateFilePath, validateFileExtension, getBackupPath, ensureBackupDir } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// BATCH FILE WRITER — Membuat file baru secara batch
// ============================================================

interface BatchFile {
  filePath: string;
  content: string;
  instructions: string;
}

interface BatchWriterParams {
  files: BatchFile[];
}

export async function handleBatchFileWriter(params: BatchWriterParams): Promise<string> {
  const { files } = params;

  // Batas maksimal 15 file
  if (files.length > 15) {
    return `Error: Maksimal 15 file per batch. Anda mengirim ${files.length} file.`;
  }

  const results: Array<{ filePath: string; success: boolean; error?: string }> = [];

  for (const file of files) {
    // Validasi konten tidak kosong
    if (!file.content || file.content.trim().length === 0) {
      results.push({ filePath: file.filePath, success: false, error: "Konten file tidak boleh kosong." });
      continue;
    }

    // Validasi instructions harus diisi
    if (!file.instructions || file.instructions.trim().length === 0) {
      results.push({ filePath: file.filePath, success: false, error: "Alasan pembuatan file (instructions) wajib diisi." });
      continue;
    }
    try {
      // Validate path
      const validation = validateFilePath(file.filePath);
      if (!validation.valid) {
        results.push({ filePath: file.filePath, success: false, error: validation.error.message });
        continue;
      }

      const resolvedPath = validation.resolvedPath;

      // Validate extension
      if (!validateFileExtension(file.filePath)) {
        results.push({
          filePath: file.filePath,
          success: false,
          error: `Ekstensi file tidak diizinkan: "${path.extname(file.filePath)}". Ekstensi yang diizinkan: .ts, .js, .tsx, .jsx, .json, .md, .css, .html, .yml, .yaml, .toml, .sh, .env`,
        });
        continue;
      }

      // Check if file already exists
      if (fs.existsSync(resolvedPath)) {
        // Backup existing file
        ensureBackupDir();
        const backupPath = getBackupPath(file.filePath);
        const backupDir = path.dirname(backupPath);
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(resolvedPath, backupPath);
      }

      // Create directory if needed
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(resolvedPath, file.content, "utf-8");

      // Record to session memory
      sessionMemory.recordToolCall("batch_file_writer", {
        filePath: file.filePath,
        instructions: file.instructions,
        size: file.content.length,
      });

      results.push({ filePath: file.filePath, success: true });
    } catch (err) {
      results.push({
        filePath: file.filePath,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return formatBatchResult(results);
}

function formatBatchResult(results: Array<{ filePath: string; success: boolean; error?: string }>): string {
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  const lines: string[] = [
    `📝 Batch File Writer`,
    `✅ ${successCount} file dibuat | ❌ ${failCount} file gagal`,
    "",
  ];

  for (const r of results) {
    if (r.success) {
      lines.push(`✅ ${r.filePath} — berhasil dibuat`);
    } else {
      lines.push(`❌ ${r.filePath} — ${r.error}`);
    }
  }

  if (failCount === 0 && successCount > 0) {
    lines.push("", "✅ Semua file berhasil dibuat.");
    lines.push("💡 Jalankan execute_safe_test({task: \"typecheck\"}) untuk verifikasi.");
  }

  return lines.join("\n");
}
