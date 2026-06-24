import { sessionMemory } from "../engine/sessionMemory.js";
import { execSync } from "node:child_process";
import { getProjectRoot } from "../utils/pathValidator.js";
import { detectAllAntiPatterns, type GuardWarning } from "../guards/antiPatternDetector.js";
import { saveSnapshot, formatSnapshot } from "../engine/contextSnapshot.js";

// ============================================================
// KUMA GUARD — Context safety net for AI agents
// Combines anti-pattern detection + loop detection + drift analysis
// ============================================================

interface GuardParams {
  check?: "all" | "anti-pattern" | "loop" | "drift" | "context";
  goal?: string;
}

interface GuardReport {
  timestamp: string;
  onTrack: boolean;
  warnings: GuardWarning[];
  drifts: string[];
  suggestion: string;
  stats: {
    goal: string;
    modifiedFiles: number;
    toolCalls: number;
    unresolvedFailures: number;
    hasLoop: boolean;
    hasRunTests: boolean;
  };
}

export async function handleKumaGuard(params: GuardParams): Promise<string> {
  const { check = "all", goal: inputGoal } = params;
  const summary = sessionMemory.getSummary();
  const goal = inputGoal || (summary.currentGoal as string) || "";

  // Record the check
  sessionMemory.recordToolCall("kuma_guard", { check, goal });

  // ============================================================
  // 1. Anti-pattern detection (file scanning + bash grep detection)
  // ============================================================
  const warnings: GuardWarning[] = [];
  if (check === "all" || check === "anti-pattern") {
    warnings.push(...detectAllAntiPatterns());
  }

  // ============================================================
  // 2. Loop detection (from session memory)
  // ============================================================
  const loop = check === "all" || check === "loop"
    ? sessionMemory.detectLoop()
    : { isLooping: false };

  if (loop.isLooping) {
    warnings.push({
      severity: "high",
      pattern: "tool-loop",
      message: loop.message ?? "Detected potential tool call loop",
      suggestion: "Switch approach — try reading the file first with smart_file_picker",
    });
  }

  // ============================================================
  // 3. Drift detection (from session memory + git)
  // ============================================================
  const drifts: string[] = [];
  const toolCalls = sessionMemory.getToolCallHistory(50);
  const hasRunTests = toolCalls.some((c) => c.toolName === "execute_safe_test");

  if (check === "all" || check === "drift") {
    const modifiedFiles = sessionMemory.getModifiedFiles();
    const failedFiles = sessionMemory.getFailedFiles();

    // Unresolved failures
    let unresolvedCount = 0;
    for (const f of failedFiles) {
      for (const ff of f.failures) {
        if (!ff.resolved) unresolvedCount++;
      }
    }

    if (modifiedFiles.length > 0 && !hasRunTests) {
      drifts.push(`${modifiedFiles.length} file(s) edited but no test run`);
      warnings.push({
        severity: "medium",
        pattern: "no-test-after-edit",
        message: `${modifiedFiles.length} file(s) modified without running tests`,
        suggestion: "Run execute_safe_test({ task: \"typecheck\" }) to verify changes",
      });
    }

    if (unresolvedCount > 0) {
      drifts.push(`${unresolvedCount} unresolved failure(s)`);
    }

    // Git diff
    try {
      const root = getProjectRoot();
      const gitStat = execSync("git diff --stat", {
        cwd: root,
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (gitStat) {
        drifts.push(`Git diff: ${gitStat}`);
      }
    } catch {
      // Not a git repo or git not available
    }

    // Edit count check (Ladder philosophy)
    const editCalls = toolCalls.filter(
      (c) => c.toolName === "precise_diff_editor" || c.toolName === "batch_file_writer",
    ).length;
    if (editCalls > 5) {
      warnings.push({
        severity: "low",
        pattern: "excessive-edits",
        message: `${editCalls} file operations in a row`,
        suggestion: "Consider if all edits are needed. Run tests before making more changes.",
      });
    }
  }

  // ============================================================
  // 4. Context snapshot
  // ============================================================
  if (check === "context") {
    const snapshot = saveSnapshot(goal);
    if (!snapshot) {
      return "⚠️ Could not create context snapshot. The .kuma directory might not be accessible.";
    }
    return formatSnapshot(snapshot);
  }

  // ============================================================
  // 5. Build report
  // ============================================================
  const hasWarnings = warnings.length > 0;
  const hasDrifts = drifts.length > 0;
  const onTrack = !hasWarnings && !hasDrifts;

  let suggestion: string;
  if (warnings.some((w) => w.severity === "high" && w.pattern === "script-patching")) {
    suggestion = "Remove patch scripts and use precise_diff_editor for all file modifications";
  } else if (warnings.some((w) => w.pattern === "tool-loop")) {
    suggestion = "Switch approach — current tool is not making progress";
  } else if (warnings.some((w) => w.pattern === "no-test-after-edit")) {
    suggestion = "Run tests to verify your changes before continuing";
  } else if (warnings.some((w) => w.pattern === "bash-grep")) {
    suggestion = "Use smart_grep for code search instead of bash grep";
  } else if (warnings.some((w) => w.pattern === "excessive-edits")) {
    suggestion = "Pause and review: are all these edits necessary?";
  } else if (!goal) {
    suggestion = "No goal set — use goal parameter or setGoal to track intent";
  } else {
    suggestion = "On track — continue with current approach";
  }

  const report: GuardReport = {
    timestamp: new Date().toISOString(),
    onTrack,
    warnings,
    drifts,
    suggestion,
    stats: {
      goal,
      modifiedFiles: (summary.modifiedFiles as Array<unknown>).length,
      toolCalls: (summary.toolCallCount as number) ?? 0,
      unresolvedFailures: summary.unresolvedFailures
        ? (summary.unresolvedFailures as Array<unknown>).length
        : 0,
      hasLoop: loop.isLooping,
      hasRunTests,
    },
  };

  return JSON.stringify(report, null, 2);
}
