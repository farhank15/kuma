import { saveSnapshot, listSnapshots, formatSnapshot } from "../engine/contextSnapshot.js";

// ============================================================
// KUMA CONTEXT — Context snapshot MCP tool
// ============================================================

interface ContextParams {
  action: "save" | "list";
  goal?: string;
}

export async function handleKumaContext(params: ContextParams): Promise<string> {
  const { action, goal } = params;

  switch (action) {
    case "save": {
      const snapshot = saveSnapshot(goal);
      if (!snapshot) {
        return "\u26A0\uFE0F Could not create context snapshot. The .kuma directory might not be accessible.";
      }
      return formatSnapshot(snapshot);
    }

    case "list": {
      const snapshots = listSnapshots();
      if (snapshots.length === 0) {
        return "📸 **No snapshots found.**\n\nRun `kuma_guard({ check: \"context\" })` or `kuma_context({ action: \"save\" })` to create one.";
      }

      const lines: string[] = [
        `📸 **Context Snapshots** — ${snapshots.length} available`,
        "",
      ];

      for (let i = 0; i < snapshots.length; i++) {
        const s = snapshots[i];
        const fileCount = s.modifiedFiles.length;
        const failureCount = s.unresolvedFailures.length;
        lines.push(
          `[${i + 1}] ${s.timestamp}`,
          `    🎯 Goal: ${s.goal || "(not set)"}`,
          `    📁 ${fileCount} files, ❌ ${failureCount} failures, 🔧 ${s.toolCallCount} tool calls`,
          `    📊 Git: ${s.gitDiffStat || "clean"}`,
          "",
        );
      }

      lines.push("💡 Use kuma_context({ action: \"save\" }) to create a new snapshot.");
      lines.push("💡 Or kuma_guard({ check: \"context\" }) to save and get full context.");
      return lines.join("\n");
    }

    default:
      return `Error: Action "${action}" not supported. Use "save" or "list".`;
  }
}
