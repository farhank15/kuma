import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { sessionMemory } from "./sessionMemory.js";
import { getProjectRoot } from "../utils/pathValidator.js";

// ============================================================
// CONTEXT SNAPSHOT — Save & restore project state
// ============================================================

export interface ContextSnapshot {
  version: number;
  timestamp: string;
  goal: string;
  modifiedFiles: Array<{
    filePath: string;
    status: string;
    modifiedAt: number;
  }>;
  unresolvedFailures: Array<{ task: string; error: string }>;
  toolCallCount: number;
  gitDiffStat: string;
  completedSteps: string[];
  hasConventions: boolean;
}

const SNAPSHOT_DIR = "context-snapshots";

function snapshotDir(): string {
  return path.join(getProjectRoot(), ".kuma", SNAPSHOT_DIR);
}

function ensureSnapshotDir(): void {
  const dir = snapshotDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function snapshotFilePath(timestamp: number): string {
  return path.join(snapshotDir(), `${timestamp}.json`);
}

/**
 * Capture current session state and save as a snapshot.
 * Returns the snapshot metadata, or null if saving fails.
 */
export function saveSnapshot(goal?: string): ContextSnapshot | null {
  try {
    ensureSnapshotDir();
  } catch {
    return null;
  }

  const summary = sessionMemory.getSummary();

  const snapshot: ContextSnapshot = {
    version: 1,
    timestamp: new Date().toISOString(),
    goal: goal || (summary.currentGoal as string) || "",
    modifiedFiles: (summary.modifiedFiles as Array<{ filePath: string; status: string; modifiedAt: number }>) || [],
    unresolvedFailures: (summary.unresolvedFailures as Array<{ task: string; error: string }>) || [],
    toolCallCount: (summary.toolCallCount as number) || 0,
    gitDiffStat: getGitDiffStat(),
    completedSteps: (summary.completedSteps as string[]) || [],
    hasConventions: !!(summary.hasConventions as boolean),
  };

  try {
    fs.writeFileSync(snapshotFilePath(Date.now()), JSON.stringify(snapshot, null, 2), "utf-8");
  } catch {
    // Failed to write snapshot - return the data anyway
  }

  sessionMemory.recordToolCall("kuma_context", { action: "save", goal: snapshot.goal });
  return snapshot;
}

/**
 * List all available snapshots sorted by most recent first.
 */
export function listSnapshots(): ContextSnapshot[] {
  const dir = snapshotDir();
  if (!fs.existsSync(dir)) return [];

  try {
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort((a, b) => b.localeCompare(a)); // newest first

    return files.map((f) => {
      try {
        const content = fs.readFileSync(path.join(dir, f), "utf-8");
        return JSON.parse(content) as ContextSnapshot;
      } catch {
        return null;
      }
    }).filter((s): s is ContextSnapshot => s !== null);
  } catch {
    return [];
  }
}

/**
 * Format a snapshot as human-readable string.
 */
export function formatSnapshot(snapshot: ContextSnapshot): string {
  const lines: string[] = [
    `📸 **Context Snapshot** — ${snapshot.timestamp}`,
    "",
    `🎯 **Goal:** ${snapshot.goal || "(not set)"}`,
    `📁 **Modified Files:** ${snapshot.modifiedFiles.length}`,
    `❌ **Unresolved Failures:** ${snapshot.unresolvedFailures.length}`,
    `🔧 **Tool Calls:** ${snapshot.toolCallCount}`,
    `📊 **Git Diff:** ${snapshot.gitDiffStat || "clean"}`,
    `✅ **Completed Steps:** ${snapshot.completedSteps.length}`,
    `📐 **Conventions:** ${snapshot.hasConventions ? "detected" : "not detected"}`,
    "",
  ];

  if (snapshot.modifiedFiles.length > 0) {
    lines.push("**Modified Files:**");
    for (const f of snapshot.modifiedFiles) {
      lines.push(`  - ${f.filePath} (${f.status})`);
    }
    lines.push("");
  }

  if (snapshot.unresolvedFailures.length > 0) {
    lines.push("**Unresolved Failures:**");
    for (const f of snapshot.unresolvedFailures) {
      lines.push(`  - [${f.task}] ${f.error.substring(0, 150)}`);
    }
    lines.push("");
  }

  lines.push("💡 Use kuma_guard({ check: \"context\" }) to create a new snapshot.");
  return lines.join("\n");
}



function getGitDiffStat(): string {
  try {
    const root = getProjectRoot();
    const stdout = execSync("git diff --stat", {
      cwd: root,
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    return stdout || "clean";
  } catch {
    return "clean";
  }
}
