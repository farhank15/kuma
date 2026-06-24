import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "../utils/pathValidator.js";

// ============================================================
// KUMA INIT — Generate/append AI agent config files
// ============================================================

export type ConfigType =
  | "claude"
  | "cursor"
  | "windsurf"
  | "copilot"
  | "cline"
  | "aider"
  | "antigravity"
  | "opencode"
  | "codex"
  | "qwen"
  | "kiro"
  | "openclaw"
  | "codewhale";

export const ALL_CONFIG_TYPES: ConfigType[] = [
  "claude",
  "cursor",
  "windsurf",
  "copilot",
  "cline",
  "aider",
  "antigravity",
  "opencode",
  "codex",
  "qwen",
  "kiro",
  "openclaw",
  "codewhale",
];

export const CONFIG_LABELS: Record<ConfigType, string> = {
  claude: "Claude Code (CLAUDE.md / plugin)",
  cursor: "Cursor (.cursor/rules/*.mdc)",
  windsurf: "Windsurf (.windsurfrules)",
  copilot: "GitHub Copilot Editor (AGENTS.md + Skill)",
  cline: "Cline (.clinerules/*.md)",
  aider: "Aider (CONVENTIONS.md via .aider.conf.yml)",
  antigravity: "Antigravity CLI (.agents/skills/)",
  opencode: "OpenCode (opencode.json)",
  codex: "Codex CLI (AGENTS.md + .codex/config.toml)",
  qwen: "Qwen Code (AGENTS.md + settings.json)",
  kiro: "Kiro (.kiro/steering/*.md)",
  openclaw: "OpenClaw (skills/)",
  codewhale: "CodeWhale (skills/ + .codewhale/mcp.json)",
};

function configFilePath(type: ConfigType): string {
  switch (type) {
    case "claude": return "CLAUDE.md";
    case "cursor": return ".cursor/rules/kuma.mdc";
    case "windsurf": return ".windsurfrules";
    case "copilot": return "AGENTS.md";
    case "cline": return ".clinerules/kuma.md";
    case "aider": return "CONVENTIONS.md";
    case "antigravity": return ".agents/skills/kuma/SKILL.md";
    case "opencode": return "opencode.json";
    case "codex": return "AGENTS.md";
    case "qwen": return "AGENTS.md";
    case "kiro": return ".kiro/steering/kuma.md";
    case "openclaw": return "skills/kuma/SKILL.md";
    case "codewhale": return "skills/kuma/SKILL.md";
  }
}

// ============================================================
// TEMPLATES
// ============================================================

const CORE_RULES = [
  "## AI Agent Usage Guidelines",
  "",
  "Kuma MCP tools are available. Use them correctly:",
  "",
  "### Code Search",
  "- Use the **smart_grep** tool to search code - NOT bash grep/ripgrep manually",
  "- smart_grep returns line numbers + context, caches results, respects .gitignore",
  '- **Example:** smart_grep({ query: "function handleAuth", extensions: [\'ts\'] })',
  "",
  "### Reading Code",
  "- Use the **smart_file_picker** tool to read files with smart chunking",
  "- For large files, use startLine/endLine to read specific ranges",
  '- **Example:** smart_file_picker({ filePath: "src/index.ts", chunkStrategy: "outline" })',
  '- **Example:** smart_file_picker({ filePath: "src/index.ts", startLine: 10, endLine: 30 })',
  "",
  "### Editing Code",
  "- Use the **precise_diff_editor** tool to edit files (fuzzy matching + auto-backup)",
  "- DO NOT create Python/Node scripts to patch files; use precise_diff_editor directly",
  "- DO NOT use bash sed/cat/awk to modify source files",
  '- **Example:** precise_diff_editor({ filePath: "src/app.ts", edits: [{ searchBlock: "old code", replaceBlock: "new code" }] })',
  '- **Example:** precise_diff_editor({ filePath: "src/app.ts", dryRun: true, edits: [...] })',
  '- **Example:** precise_diff_editor({ filePath: "src/app.ts", action: "rollback" })',
  "",
  "### Creating Files",
  "- Use the **batch_file_writer** tool to create new files (up to 15 at once)",
  '- **Example:** batch_file_writer({ files: [{ filePath: "src/util.ts", content: "// code", instructions: "reason for creating" }] })',
  "",
  "### Running Tasks",
  "- Use the **execute_safe_test** tool for test/build/lint/typecheck",
  "- Always run typecheck after editing TypeScript files",
  '- **Example:** execute_safe_test({ task: "typecheck" })',
  '- **Example:** execute_safe_test({ task: "custom", customCommand: "npm run lint" })',
  "",
  "### Code Review",
  "- Use the **code_reviewer** tool after changes",
  "- Supports focus: correctness, security, performance, over-engineering",
  '- **Example:** code_reviewer({ focus: "security" })',
  "- **Example:** code_reviewer({ files: [\"src/auth.ts\"], format: \"json\" })",
  "",
  "### Git Operations",
  "- Use the **git_diff** tool for structured diff output",
  "- Use the **git_log** tool for commit history",
  '- **Example:** git_log({ maxCount: 5 })',
  '- **Example:** git_diff({ staged: true })',
  "",
  "### Session Awareness",
  "- Use the **kuma_reflect** tool to check on-track/drift/loops",
  "- Use the **kuma_guard** tool for deeper safety checks (anti-patterns, auto-detection)",
  "- Use the **get_session_memory** tool to recall session state",
  '- **Example:** kuma_reflect({ goal: "refactor auth" })',
  '- **Example:** kuma_guard({ check: "all", goal: "refactor auth" })',
  "",
  "### LSP / Code Intelligence",
  "- Use the **lsp_query** tool for go-to-definition, find references, type info",
  '- **Example:** lsp_query({ filePath: "src/index.ts", line: 5, character: 10, action: "def" })',
  '- **Example:** lsp_query({ filePath: "src/index.ts", line: 5, character: 10, action: "refs" })',
  "",
  "### Static Analysis",
  "- Use the **static_analysis** tool to run ESLint/TSC/Prettier/Ruff",
  '- **Example:** static_analysis({ tool: "eslint", autoFix: true })',
  "",
  "### Project Structure",
  "- Use the **project_structure** tool to see project layout",
  '- **Example:** project_structure({ depth: 2, folderOnly: true })',
  "",
  "### Write Memory",
  "- Use the **write_memory** tool to persist decisions and glossary",
  '- **Example:** write_memory({ topic: "decisions", content: "## Reason for using X" })',
  "",
  "### General Rules",
  "- When you error, READ the error carefully before acting",
  "- After 3+ edits without running tests, stop and verify",
  "- If a tool fails, check the message - don't retry blindly",
  "- Detect conventions first with the **project_conventions** tool",
  '- **Example:** project_conventions({ forceRescan: true })',
].join("\n");

const KUMA_CORE_INSTRUCTIONS = CORE_RULES;

function claudeTemplate(): string {
  return [
    "# Kuma AI Agent Guidelines",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "## Workflow Pipeline",
    "",
    "For best results:",
    "1. **project_conventions** - detect stack",
    "2. **smart_grep** / **smart_file_picker** - understand code",
    "3. **precise_diff_editor** / **batch_file_writer** - make changes",
    "4. **execute_safe_test** - verify (typecheck + test)",
    "5. **code_reviewer** - review changes",
  ].join("\n");
}

/** Cursor .cursor/rules/kuma.mdc template with YAML frontmatter */
function cursorRulesTemplate(): string {
  return [
    "---",
    "description: Kuma MCP tool usage rules for AI coding agents",
    "alwaysApply: true",
    "---",
    "",
    "You are an expert engineer. Kuma MCP tools are available.",
    "",
    "## Critical Rules",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "## NEVER",
    "- Never create Python/Node scripts to patch code",
    "- Never use bash sed/cat/awk to edit source files",
    "- Never run git push/git commit through bash",
  ].join("\n");
}

function windsurfRulesTemplate(): string {
  return [
    "# Windsurf Cascade Rules with Kuma",
    "",
    KUMA_CORE_INSTRUCTIONS,
  ].join("\n");
}

/** Copilot Editor AGENTS.md section */
function copilotTemplate(): string {
  return [
    "## GitHub Copilot Editor",
    "",
    "Kuma MCP tools are available. Use them correctly:",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "### Copilot Editor-Specific",
    "- Copilot Editor reads AGENTS.md at project root for persistent instructions",
    "- Configure MCP servers via VS Code settings (cmd+shift+P → Developer: Reload Window after adding Kuma)",
    "- Use kuma_guard periodically to check for anti-patterns",
  ].join("\n");
}

/** Cline .clinerules/kuma.md template with paths frontmatter */
function clineRulesTemplate(): string {
  return [
    "---",
    "description: Kuma MCP tool usage rules for AI coding agents",
    "paths:",
    "  - \"*\"",
    "---",
    "",
    KUMA_CORE_INSTRUCTIONS,
  ].join("\n");
}

/** Aider CONVENTIONS.md template (referenced from .aider.conf.yml via read:) */
function aiderTemplate(): string {
  return [
    "# Kuma MCP - Aider Coding Conventions",
    "",
    "These conventions are loaded by Aider via the `read:` field in .aider.conf.yml",
    "",
    KUMA_CORE_INSTRUCTIONS,
  ].join("\n");
}

/** OpenCode opencode.json template */
function opencodeTemplate(): string {
  const config = {
    mcp: {
      kuma: {
        type: "local",
        command: ["npx", "-y", "@plumpslabs/kuma"],
        enabled: true,
      },
    },
    instructions: ["CLAUDE.md"],
  };
  const header = [
    "// Generated by Kuma MCP - https://github.com/plumpslabs/kuma",
    "// OpenCode config with Kuma MCP tools. Edit opencode.json to customize.",
    "",
  ].join("\n");
  return header + JSON.stringify(config, null, 2) + "\n";
}

/** Codex CLI AGENTS.md section */
function codexTemplate(): string {
  return [
    "## Codex CLI (OpenAI)",
    "",
    "Kuma MCP tools are available. Use them correctly:",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "### Codex-Specific",
    "- Codex uses cascading AGENTS.md files (global ~/.codex/AGENTS.md -> project AGENTS.md)",
    "- MCP config is in .codex/config.toml (auto-generated by kuma init)",
    "- Use kuma_guard periodically to check for anti-patterns",
  ].join("\n");
}

/** Codex CLI .codex/config.toml (secondary file) */
function codexConfigTomlTemplate(): string {
  return [
    "# Generated by Kuma MCP - https://github.com/plumpslabs/kuma",
    '# Kuma MCP server config for Codex CLI',
    "",
    "[mcp_servers.kuma]",
    'command = "npx"',
    'args = ["-y", "@plumpslabs/kuma"]',
    "",
  ].join("\n");
}

/** Qwen Code AGENTS.md section */
function qwenTemplate(): string {
  return [
    "## Qwen Code",
    "",
    "Kuma MCP tools are available. Use them correctly:",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "### Qwen-Specific",
    "- Qwen reads AGENTS.md at project root for persistent instructions",
    "- MCP config is in settings.json (auto-generated by kuma init)",
    "- Use kuma_guard periodically to check for anti-patterns",
  ].join("\n");
}

/** Qwen Code settings.json (secondary file - MCP servers) */
function qwenSettingsTemplate(): string {
  const config = {
    mcpServers: {
      kuma: {
        command: "npx",
        args: ["-y", "@plumpslabs/kuma"],
        env: {},
      },
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}

/** Kiro .kiro/steering/kuma.md template with YAML frontmatter */
function kiroRulesTemplate(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma safety toolkit - use smart_grep for search, precise_diff_editor for edits",
    "inclusion: always",
    "---",
    "",
    "# Kuma MCP - Kiro Steering",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "## Kiro-Specific",
    "- Kiro reads steering files from .kiro/steering/ for project instructions",
    "- Configure MCP servers via IDE settings or global Kiro config",
    "- Use kuma_guard periodically to check for anti-patterns",
  ].join("\n");
}

/** OpenClaw skills/kuma/SKILL.md template (skill di-load saat dibutuhkan) */
function openclawSkillTemplate(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma safety toolkit for AI coding agents. Use smart_grep for search, precise_diff_editor for edits, execute_safe_test for verification.",
    "---",
    "",
    "# Kuma MCP - OpenClaw Skill",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "## OpenClaw-Specific",
    "- OpenClaw loads skills/ from workspace root or ~/.openclaw/skills for global",
    "- Configure Kuma MCP server via ~/.openclaw/openclaw.json or agents standard",
    "- Use kuma_guard periodically to check for anti-patterns",
    "",
    "## Verification",
    "- After edits, run execute_safe_test to verify no breakage",
    "- Use code_reviewer for correctness/security review",
    "- Check kuma_reflect to confirm on-track",
  ].join("\n");
}

/** CodeWhale skills/kuma/SKILL.md template (CodeWhale loads skills as SKILL.md files) */
function codewhaleTemplate(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma safety toolkit for AI coding agents. Use smart_grep for search, precise_diff_editor for edits, execute_safe_test for verification.",
    "---",
    "",
    "# Kuma MCP - CodeWhale Skill",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "## CodeWhale-Specific",
    "- CodeWhale loads SKILL.md from skills/ (workspace-local), .agents/skills/, or ~/.codewhale/skills/",
    "- MCP config is in ~/.codewhale/mcp.json or ~/.deepseek/mcp.json",
    "- Use kuma_guard periodically to check for anti-patterns",
    "",
    "## Verification",
    "- After edits, run execute_safe_test to verify no breakage",
    "- Use code_reviewer for correctness/security review",
    "- Check kuma_reflect to confirm on-track",
  ].join("\n");
}

/** Antigravity SKILL.md template */
function antigravitySkillTemplate(): string {
  return [
    "---",
    "name: kuma-mcp",
    "description: Kuma safety toolkit for AI coding agents. Use smart_grep for search, precise_diff_editor for edits, execute_safe_test for verification.",
    "---",
    "",
    "# Kuma MCP - Antigravity Skill",
    "",
    KUMA_CORE_INSTRUCTIONS,
    "",
    "## Verification",
    "- After edits, run execute_safe_test to verify no breakage",
    "- Use code_reviewer for correctness/security review",
    "- Check kuma_reflect to confirm on-track",
  ].join("\n");
}

/** Antigravity mcp_config.json template */
function antigravityMcpConfigTemplate(): string {
  const config = {
    mcpServers: {
      kuma: {
        command: "npx",
        args: ["-y", "@plumpslabs/kuma"],
        env: {},
      },
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}

const TEMPLATES: Record<ConfigType, () => string> = {
  claude: claudeTemplate,
  cursor: cursorRulesTemplate,
  windsurf: windsurfRulesTemplate,
  copilot: copilotTemplate,
  cline: clineRulesTemplate,
  aider: aiderTemplate,
  antigravity: antigravitySkillTemplate,
  opencode: opencodeTemplate,
  codex: codexTemplate,
  qwen: qwenTemplate,
  kiro: kiroRulesTemplate,
  openclaw: openclawSkillTemplate,
  codewhale: codewhaleTemplate,
};

const APPEND_SEPARATOR =
  "\n\n---\n_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_\n\n";

// ============================================================
// INIT LOGIC
// ============================================================

export interface InitResult {
  type: ConfigType;
  filePath: string;
  action: "created" | "appended" | "skipped" | "error";
  error?: string;
}

/** Generate OpenCode instructions reference (secondary entry in opencode.json) */
function handleOpencodeSecondary(root: string, results: InitResult[]): void {
  // OpenCode's MCP config is embedded in opencode.json (already generated),
  // but we also add a symlink to CLAUDE.md for the instructions path
  const claudePath = path.resolve(root, "CLAUDE.md");
  // If CLAUDE.md doesn't exist, create a minimal one that opencode.json references
  if (!fs.existsSync(claudePath)) {
    try {
      fs.writeFileSync(claudePath, [
        "# Kuma MCP - OpenCode Instructions",
        "",
        KUMA_CORE_INSTRUCTIONS,
      ].join("\n"), "utf-8");
      results.push({ type: "opencode", filePath: "CLAUDE.md", action: "created" });
    } catch (err) {
      results.push({
        type: "opencode",
        filePath: "CLAUDE.md",
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Generate Codex CLI .codex/config.toml as secondary file */
function handleCodexSecondary(root: string, results: InitResult[]): void {
  const tomlPath = path.resolve(root, ".codex/config.toml");
  if (results.some(r => r.filePath === ".codex/config.toml")) return;

  try {
    const dir = path.dirname(tomlPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(tomlPath)) {
      const existingContent = fs.readFileSync(tomlPath, "utf-8");
      if (existingContent.includes("kuma")) {
        results.push({ type: "codex", filePath: ".codex/config.toml", action: "skipped" });
        return;
      }
      fs.writeFileSync(tomlPath, existingContent.trimEnd() + "\n\n" + codexConfigTomlTemplate(), "utf-8");
      results.push({ type: "codex", filePath: ".codex/config.toml", action: "appended" });
    } else {
      fs.writeFileSync(tomlPath, codexConfigTomlTemplate(), "utf-8");
      results.push({ type: "codex", filePath: ".codex/config.toml", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "codex",
      filePath: ".codex/config.toml",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate Qwen Code settings.json as secondary file */
function handleQwenSecondary(root: string, results: InitResult[]): void {
  const settingsPath = path.resolve(root, "settings.json");
  if (results.some(r => r.filePath === "settings.json")) return;

  try {
    if (fs.existsSync(settingsPath)) {
      const existingContent = fs.readFileSync(settingsPath, "utf-8");
      if (existingContent.includes("kuma")) {
        if (!existingContent.includes("_Generated by Kuma MCP_")) {
          try {
            const parsed = JSON.parse(existingContent);
            parsed.mcpServers = parsed.mcpServers || {};
            if (!parsed.mcpServers.kuma) {
              parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
              fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
              results.push({ type: "qwen", filePath: "settings.json", action: "appended" });
              return;
            }
          } catch {
            // If JSON parse fails, fall through to skipped
          }
        }
        results.push({ type: "qwen", filePath: "settings.json", action: "skipped" });
        return;
      }
      try {
        const parsed = JSON.parse(existingContent);
        parsed.mcpServers = parsed.mcpServers || {};
        if (!parsed.mcpServers.kuma) {
          parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
          fs.writeFileSync(settingsPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
          results.push({ type: "qwen", filePath: "settings.json", action: "appended" });
        }
      } catch {
        // If JSON parse fails, skip
      }
    } else {
      fs.writeFileSync(settingsPath, qwenSettingsTemplate(), "utf-8");
      results.push({ type: "qwen", filePath: "settings.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "qwen",
      filePath: "settings.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ============================================================
// AGENTS.md MERGE LOGIC
// ============================================================

/** Config types that target AGENTS.md (need merge dedup) */
const AGENTS_MD_TYPES: ConfigType[] = ["codex", "qwen", "copilot"];

function getAgentsMdHeader(): string {
  return [
    "# Kuma MCP - Combined Agent Instructions",
    "",
    "This file contains instructions for AI coding agents that read AGENTS.md.",
    "Each section applies to a specific agent. Unused sections can be safely removed.",
    "",
    "---",
    "_Generated by Kuma MCP - https://github.com/plumpslabs/kuma_",
    "",
  ].join("\n");
}

/** Generate combined AGENTS.md content from selected types */
function getCombinedAgentsMd(selectedTypes: Set<ConfigType>): string {
  const sections: string[] = [getAgentsMdHeader()];
  const agentOrder: ConfigType[] = ["codex", "qwen", "copilot"];
  for (const t of agentOrder) {
    if (selectedTypes.has(t)) {
      sections.push(TEMPLATES[t]());
    }
  }
  return sections.join("\n\n---\n\n");
}

/** Generate Antigravity mcp_config.json as secondary file */
function handleAntigravityMcpConfig(root: string, results: InitResult[]): void {
  const mcpPath = path.resolve(root, ".agents/mcp_config.json");
  // Avoid duplicate processing
  if (results.some(r => r.filePath === ".agents/mcp_config.json")) return;

  try {
    const mcpDir = path.dirname(mcpPath);
    if (fs.existsSync(mcpPath)) {
      const existingContent = fs.readFileSync(mcpPath, "utf-8");
      if (existingContent.includes("kuma")) {
        if (!existingContent.includes("_Generated by Kuma MCP_")) {
          const trimmed = existingContent.trimEnd();
          if (trimmed.endsWith("}")) {
            const updated = trimmed.slice(0, -1).trimEnd() + ',\n  "_kuma_note": "Kuma MCP - Generated by kuma init"\n}\n';
            fs.writeFileSync(mcpPath, updated, "utf-8");
            results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "appended" });
          }
        }
        return;
      }
      // Merge Kuma into existing mcp_config.json
      const parsed = JSON.parse(existingContent);
      parsed.mcpServers = parsed.mcpServers || {};
      parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
      fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "appended" });
    } else {
      if (!fs.existsSync(mcpDir)) fs.mkdirSync(mcpDir, { recursive: true });
      fs.writeFileSync(mcpPath, antigravityMcpConfigTemplate(), "utf-8");
      results.push({ type: "antigravity", filePath: ".agents/mcp_config.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "antigravity",
      filePath: ".agents/mcp_config.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate Aider .aider.conf.yml with read: CONVENTIONS.md reference */
function handleAiderSecondary(root: string, results: InitResult[]): void {
  const ymlPath = path.resolve(root, ".aider.conf.yml");
  if (results.some(r => r.filePath === ".aider.conf.yml")) return;

  try {
    const conventionsRef = "read: CONVENTIONS.md";
    if (fs.existsSync(ymlPath)) {
      const existingContent = fs.readFileSync(ymlPath, "utf-8");
      if (existingContent.includes("CONVENTIONS.md") || existingContent.includes("kuma")) {
        results.push({ type: "aider", filePath: ".aider.conf.yml", action: "skipped" });
        return;
      }
      const newContent = existingContent.trimEnd() + "\n\n# Kuma MCP conventions\n" + conventionsRef + "\n";
      fs.writeFileSync(ymlPath, newContent, "utf-8");
      results.push({ type: "aider", filePath: ".aider.conf.yml", action: "appended" });
    } else {
      const content = [
        "# Generated by Kuma MCP - https://github.com/plumpslabs/kuma",
        "# Aider will read CONVENTIONS.md for coding conventions",
        "",
        conventionsRef,
        "",
      ].join("\n");
      fs.writeFileSync(ymlPath, content, "utf-8");
      results.push({ type: "aider", filePath: ".aider.conf.yml", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "aider",
      filePath: ".aider.conf.yml",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate Copilot Editor .github/skills/kuma/SKILL.md as secondary skill file */
function handleCopilotSecondary(root: string, results: InitResult[]): void {
  const skillPath = path.resolve(root, ".github/skills/kuma/SKILL.md");
  if (results.some(r => r.filePath === ".github/skills/kuma/SKILL.md")) return;

  try {
    const dir = path.dirname(skillPath);
    const content = [
      "---",
      "name: kuma-mcp",
      "description: Kuma safety toolkit for AI coding agents. Use smart_grep for search, precise_diff_editor for edits, execute_safe_test for verification.",
      "---",
      "",
      "# Kuma MCP - Copilot Editor Skill",
      "",
      KUMA_CORE_INSTRUCTIONS,
    ].join("\n");

    if (fs.existsSync(skillPath)) {
      const existingContent = fs.readFileSync(skillPath, "utf-8");
      if (existingContent.includes("kuma")) {
        results.push({ type: "copilot", filePath: ".github/skills/kuma/SKILL.md", action: "skipped" });
        return;
      }
      fs.writeFileSync(skillPath, existingContent.trimEnd() + "\n\n" + content, "utf-8");
      results.push({ type: "copilot", filePath: ".github/skills/kuma/SKILL.md", action: "appended" });
    } else {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(skillPath, content, "utf-8");
      results.push({ type: "copilot", filePath: ".github/skills/kuma/SKILL.md", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "copilot",
      filePath: ".github/skills/kuma/SKILL.md",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate .agents/mcp_config.json for OpenClaw (shares same file as Antigravity) */
function handleOpenclawSecondary(root: string, results: InitResult[]): void {
  const mcpPath = path.resolve(root, ".agents/mcp_config.json");
  if (results.some(r => r.filePath === ".agents/mcp_config.json")) return;

  try {
    const dir = path.dirname(mcpPath);
    if (fs.existsSync(mcpPath)) {
      const existingContent = fs.readFileSync(mcpPath, "utf-8");
      if (existingContent.includes("kuma")) return;
      const parsed = JSON.parse(existingContent);
      parsed.mcpServers = parsed.mcpServers || {};
      parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
      fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      results.push({ type: "openclaw", filePath: ".agents/mcp_config.json", action: "appended" });
    } else {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(mcpPath, antigravityMcpConfigTemplate(), "utf-8");
      results.push({ type: "openclaw", filePath: ".agents/mcp_config.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "openclaw",
      filePath: ".agents/mcp_config.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Generate CodeWhale .codewhale/mcp.json as secondary file */
function handleCodewhaleSecondary(root: string, results: InitResult[]): void {
  const mcpPath = path.resolve(root, ".codewhale/mcp.json");
  if (results.some(r => r.filePath === ".codewhale/mcp.json")) return;

  try {
    const dir = path.dirname(mcpPath);
    if (fs.existsSync(mcpPath)) {
      const existingContent = fs.readFileSync(mcpPath, "utf-8");
      if (existingContent.includes("kuma")) return;
      const parsed = JSON.parse(existingContent);
      parsed.mcpServers = parsed.mcpServers || {};
      parsed.mcpServers.kuma = { command: "npx", args: ["-y", "@plumpslabs/kuma"], env: {} };
      fs.writeFileSync(mcpPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8");
      results.push({ type: "codewhale", filePath: ".codewhale/mcp.json", action: "appended" });
    } else {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const config = {
        mcpServers: {
          kuma: {
            command: "npx",
            args: ["-y", "@plumpslabs/kuma"],
            env: {},
          },
        },
      };
      fs.writeFileSync(mcpPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
      results.push({ type: "codewhale", filePath: ".codewhale/mcp.json", action: "created" });
    }
  } catch (err) {
    results.push({
      type: "codewhale",
      filePath: ".codewhale/mcp.json",
      action: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function runInit(
  types: ConfigType[],
  projectRoot?: string,
): InitResult[] {
  const root = projectRoot ?? getProjectRoot();
  const selected = types.length > 0 ? types : ALL_CONFIG_TYPES;
  const results: InitResult[] = [];

  // Pre-compute which AGENTS.md types are selected for merge logic
  const selectedSet = new Set(selected);
  const agentsMdSelected = AGENTS_MD_TYPES.filter(t => selectedSet.has(t));
  let agentsMdHandled = false;

  for (const type of selected) {
    const relativePath = configFilePath(type);
    const fullPath = path.resolve(root, relativePath);
    const getTemplate = TEMPLATES[type];

    try {
      // AGENTS.md merge: first AGENTS.md type generates combined content
      if (AGENTS_MD_TYPES.includes(type) && !agentsMdHandled) {
        agentsMdHandled = true;
        const combinedContent = getCombinedAgentsMd(new Set(agentsMdSelected));

        if (fs.existsSync(fullPath)) {
          const existingContent = fs.readFileSync(fullPath, "utf-8");
          if (existingContent.includes("_Generated by Kuma MCP_")) {
            results.push({ type, filePath: relativePath, action: "skipped" });
          } else {
            fs.writeFileSync(fullPath, existingContent.trimEnd() + "\n\n" + combinedContent, "utf-8");
            results.push({ type, filePath: relativePath, action: "appended" });
          }
        } else {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fullPath, combinedContent, "utf-8");
          results.push({ type, filePath: relativePath, action: "created" });
        }

        // Handle AGENTS.md secondary files for all selected types
        if (selectedSet.has("codex")) handleCodexSecondary(root, results);
        if (selectedSet.has("qwen")) handleQwenSecondary(root, results);
        if (selectedSet.has("copilot")) handleCopilotSecondary(root, results);
      } else if (AGENTS_MD_TYPES.includes(type) && agentsMdHandled) {
        // Already handled by the first AGENTS.md type
        results.push({ type, filePath: relativePath, action: "skipped" });
        continue;
      } else {
        const template = getTemplate();

        if (fs.existsSync(fullPath)) {
          const existingContent = fs.readFileSync(fullPath, "utf-8");

          if (existingContent.includes("_Generated by Kuma MCP_")) {
            // For antigravity/openclaw/codewhale, still try secondary even if primary skipped
            if (type === "antigravity") {
              handleAntigravityMcpConfig(root, results);
            } else if (type === "openclaw") {
              handleOpenclawSecondary(root, results);
            } else if (type === "codewhale") {
              handleCodewhaleSecondary(root, results);
            }
            results.push({ type, filePath: relativePath, action: "skipped" });
            continue;
          }

          const newContent = existingContent.trimEnd() + APPEND_SEPARATOR + template;
          fs.writeFileSync(fullPath, newContent, "utf-8");
          results.push({ type, filePath: relativePath, action: "appended" });
        } else {
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(fullPath, template, "utf-8");
          results.push({ type, filePath: relativePath, action: "created" });
        }

        // Secondary files for non-AGENTS.md types
        if (type === "antigravity") {
          handleAntigravityMcpConfig(root, results);
        } else if (type === "openclaw") {
          handleOpenclawSecondary(root, results);
        } else if (type === "codewhale") {
          handleCodewhaleSecondary(root, results);
        } else if (type === "aider") {
          handleAiderSecondary(root, results);
        } else if (type === "opencode") {
          handleOpencodeSecondary(root, results);
        }
      }
    } catch (err) {
      results.push({
        type,
        filePath: relativePath,
        action: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

// ============================================================
// FORMAT OUTPUT
// ============================================================

export function formatInitResults(results: InitResult[]): string {
  const lines: string[] = [
    "\u{1F43B} **Kuma Init - AI Agent Config Generator**",
    "",
  ];

  for (const r of results) {
    const label = CONFIG_LABELS[r.type];
    switch (r.action) {
      case "created":
        lines.push("  \u2705 " + label);
        lines.push("     \u2192 Created: " + r.filePath);
        break;
      case "appended":
        lines.push("  \u2795 " + label);
        lines.push("     \u2192 Appended to: " + r.filePath);
        break;
      case "skipped":
        lines.push("  \u23ED " + label);
        lines.push("     \u2192 Skipped (already has Kuma): " + r.filePath);
        break;
      case "error":
        lines.push("  \u274C " + label);
        lines.push("     \u2192 Error: " + (r.error ?? "unknown"));
        break;
    }
  }

  const created = results.filter(r => r.action === "created").length;
  const appended = results.filter(r => r.action === "appended").length;
  const skipped = results.filter(r => r.action === "skipped").length;
  const errors = results.filter(r => r.action === "error").length;

  lines.push(
    "",
    "\u{1F4CA} Summary: " + created + " created, " + appended + " appended, "
      + skipped + " skipped, " + errors + " errors",
    "",
    "\u{1F4A1} Config files teach your AI how to use Kuma tools.",
    "\u{1F4A1} Run again to generate additional config files anytime.",
  );

  return lines.join("\n");
}
