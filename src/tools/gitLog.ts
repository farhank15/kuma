import { sessionMemory } from "../engine/sessionMemory.js";
import { runGitCommand } from "../utils/gitUtils.js";

// ============================================================
// GIT LOG — Get structured commit history
// ============================================================

interface GitLogParams {
  maxCount?: number;
  filePath?: string;
}

export async function handleGitLog(params: GitLogParams): Promise<string> {
  const { maxCount = 10, filePath } = params;

  try {
    let command = `git log -n ${maxCount} --oneline`;
    if (filePath) {
      command += ` -- "${filePath}"`;
    }

    const stdout = runGitCommand(command);

    sessionMemory.recordToolCall("git_log", { maxCount, filePath });

    if (!stdout.trim()) {
      return `ℹ️ No commit history found${filePath ? ` for file "${filePath}"` : ""}.`;
    }

    return `📜 **Git Commit History**:\n\n${stdout}`;
  } catch (err) {
    return `Error: Failed to get git log: ${err instanceof Error ? err.message : String(err)}`;
  }
}
