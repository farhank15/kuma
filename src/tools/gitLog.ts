import child_process from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// GIT LOG — Mendapatkan history commit terstruktur
// ============================================================

interface GitLogParams {
  maxCount?: number;
  filePath?: string;
}

export async function handleGitLog(params: GitLogParams): Promise<string> {
  const { maxCount = 10, filePath } = params;
  const root = getProjectRoot();

  try {
    let command = `git log -n ${maxCount} --oneline`;
    if (filePath) {
      command += ` -- "${filePath}"`;
    }

    const stdout = child_process.execSync(command, {
      cwd: root,
      encoding: "utf-8",
    });

    sessionMemory.recordToolCall("git_log", { maxCount, filePath });

    if (!stdout.trim()) {
      return `ℹ️ Tidak ada commit history ditemukan${filePath ? ` untuk file "${filePath}"` : ""}.`;
    }

    return `📜 **Git Commit History**:\n\n${stdout}`;
  } catch (err) {
    return `Error: Gagal mengambil git log: ${err instanceof Error ? err.message : String(err)}`;
  }
}
