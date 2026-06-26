import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";
import { sessionMemory } from "../engine/sessionMemory.js";

// ============================================================
// KUMA INIT — Load all .kuma/ context into the session
// ============================================================
// Called once per session to hydrate conventions, rules, memories,
// and previous-session state so the AI doesn't start blank.

interface KumaInitParams {
  projectRoot?: string;
}

export async function handleKumaInit(params: KumaInitParams): Promise<string> {
  const root = params.projectRoot ?? getProjectRoot();
  const kumaDir = path.join(root, ".kuma");
  const memoriesDir = path.join(kumaDir, "memories");
  const initMdPath = path.join(kumaDir, "init.md");

  sessionMemory.recordToolCall("kuma_init", { projectRoot: root });

  // 1. Load init.md (behavioral rules)
  let rules = "";
  if (fs.existsSync(initMdPath)) {
    rules = fs.readFileSync(initMdPath, "utf-8");
  }

  // 3. Load memory files
  const memories: Array<{ topic: string; content: string }> = [];
  if (fs.existsSync(memoriesDir)) {
    try {
      const files = fs.readdirSync(memoriesDir).filter(f => f.endsWith(".md"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(memoriesDir, file), "utf-8");
          memories.push({ topic: file.replace(/\.md$/, ""), content });
        } catch {
          // skip unreadable
        }
      }
    } catch {
      // skip
    }
  }

  // 2. Hydrate session memory from previous session data
  const sessionLoad = sessionMemory.loadSession();

  // 5. Build formatted output
  const sections: string[] = [
    "🧠 **Kuma Context Loaded**",
    "━━━━━━━━━━━━━━━━━━━━━━━━",
  ];

  // Rules summary
  const rulesLineCount = rules ? rules.split("\n").filter(l => l.trim()).length : 0;
  sections.push(`📋 **Rules:** ${rulesLineCount} lines from .kuma/init.md`);

  // Memories summary
  if (memories.length > 0) {
    const memoryList = memories.map(m => `  • **${m.topic}** — ${m.content.split("\n").filter(l => l.trim()).length} lines`).join("\n");
    sections.push(`📁 **Memories (${memories.length}):**\n${memoryList}`);
  } else {
    sections.push("📁 **Memories:** none yet — run project_conventions() to generate");
  }

  // Previous session summary (from loadSession result)
  if (sessionLoad.hasPrevSession) {
    sections.push(
      "📊 **Previous Session:**",
      `  • 🛠️ ${sessionLoad.toolCallCount} tool calls`,
      `  • ${sessionLoad.hasConventions ? "✅ conventions detected" : "❌ no conventions"}`,
    );
  } else {
    sections.push("📊 **Previous Session:** none — first session for this project");
  }

  sections.push(
    "━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
    "💡 **Next Steps:**",
    "  • Previous session context has been loaded into session memory",
    "  • Call `get_session_memory({topic: \"...\"})` for detailed memory",
    "  • If project hasn't been scanned, run `project_conventions()`",
    "  • Or continue working — session state is ready.",
  );

  return sections.join("\n");
}
