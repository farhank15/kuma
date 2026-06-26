#!/usr/bin/env node

import { readFileSync } from "node:fs";
import * as readline from "node:readline";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./manifest.js";
import { sessionMemory } from "./engine/sessionMemory.js";
import {
  runInit,
  formatInitResults,
  ALL_CONFIG_TYPES,
  type ConfigType,
} from "./cli/init.js";

// ============================================================
// KUMA — CLI Entry Point
// ============================================================

const SERVER_NAME = "kuma";
const SERVER_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
).version;

function printHelp(): void {
  console.error(`
🐻 Kuma v${SERVER_VERSION} — Zero-setup safety toolkit for AI coding agents

Usage:
  npx @plumpslabs/kuma              Start MCP server (default)
  npx @plumpslabs/kuma init         Generate AI agent config files
  npx @plumpslabs/kuma init --all   Generate ALL config files
  npx @plumpslabs/kuma init --merge Append to existing files (default)
  npx @plumpslabs/kuma init --skip-existing Skip generation if file exists
  npx @plumpslabs/kuma init --claude --cursor  Generate specific files
  npx @plumpslabs/kuma init --help  Show this help

Available config files:
  --claude     CLAUDE.md                    (Claude Code)
  --cursor     .cursor/rules/kuma.mdc       (Cursor)
  --windsurf   .windsurfrules               (Windsurf)
  --copilot    AGENTS.md + .github/skills/  (GitHub Copilot Editor)
  --cline      .clinerules/kuma.md          (Cline)
  --aider      CONVENTIONS.md + .aider.conf.yml  (Aider)
  --antigravity .agents/skills/kuma/SKILL.md    (Antigravity CLI)
  --opencode    opencode.json                (OpenCode)
  --codex       AGENTS.md + .codex/          (Codex CLI - OpenAI)
  --qwen        AGENTS.md + settings.json    (Qwen Code)
  --kiro        .kiro/steering/kuma.md       (Kiro)
  --openclaw    skills/kuma/SKILL.md         (OpenClaw)
  --codewhale   skills/kuma/SKILL.md + .codewhale/  (CodeWhale)

If no flags specified, you'll be prompted to select files interactively.
  `);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // ============================================================
  // CLI MODE: kuma init
  // ============================================================
  if (args[0] === "init") {
    const flags = args.slice(1);

    if (flags.includes("--help") || flags.includes("-h")) {
      printHelp();
      process.exit(0);
    }

    const requestedFlags = flags.filter((f) => f.startsWith("--"));
    let selectedTypes: ConfigType[];

    // Interactive mode (no specific flags)
    if (requestedFlags.length === 0) {
      console.error("🐻 Kuma Init — AI Agent Config Generator");
      console.error("");
      console.error("Select config files to generate. Press Ctrl+C to skip.");
      console.error("");

      selectedTypes = await interactiveSelect();

      if (selectedTypes.length === 0) {
        console.error("\n⚠️ No files selected. Exiting.");
        process.exit(0);
      }
    } else {
      // From CLI flags
      if (requestedFlags.includes("--all")) {
        selectedTypes = ALL_CONFIG_TYPES;
      } else {
        const flagToType: Record<string, ConfigType> = {
          "--claude": "claude",
          "--cursor": "cursor",
          "--windsurf": "windsurf",
          "--copilot": "copilot",
          "--cline": "cline",
          "--aider": "aider",
          "--antigravity": "antigravity",
          "--opencode": "opencode",
          "--codex": "codex",
          "--qwen": "qwen",
          "--kiro": "kiro",
          "--openclaw": "openclaw",
          "--codewhale": "codewhale",
        };

        selectedTypes = [];
        for (const flag of requestedFlags) {
          const type = flagToType[flag];
          if (type) {
            selectedTypes.push(type);
          }
        }
        if (selectedTypes.length === 0) {
          console.error(
            "⚠️ No valid flags provided. Use --help to see options.",
          );
          process.exit(1);
        }
      }
    }

    const skipExisting = requestedFlags.includes("--skip-existing");

    const results = runInit({
      types: selectedTypes,
      projectRoot: process.cwd(),
      skipExisting,
    });
    const output = formatInitResults(results);

    // Print to stdout (for piping) and stderr (for human reading)
    console.log(output);

    // Reciprocal recommendation for matcha
    const fs = await import("node:fs");
    const path = await import("node:path");
    const matchaSkills = path.resolve(process.cwd(), "skills/matcha/SKILL.md");
    const matchaAgents = path.resolve(
      process.cwd(),
      ".agents/skills/matcha/SKILL.md",
    );
    const matchaCursor = path.resolve(
      process.cwd(),
      ".cursor/rules/matcha.mdc",
    );
    const matchaWindsurf = path.resolve(
      process.cwd(),
      ".windsurf/rules/matcha.md",
    );

    if (
      fs.existsSync(matchaSkills) ||
      fs.existsSync(matchaAgents) ||
      fs.existsSync(matchaCursor) ||
      fs.existsSync(matchaWindsurf)
    ) {
      console.error(
        "\n\u{1F375} Hey, I see matcha is installed \u2014 they pair well together!",
      );
    }

    process.exit(0);
  }

  // ============================================================
  // MCP SERVER MODE (default)
  // ============================================================

  sessionMemory.init({
    projectRoot: process.cwd(),
    startTime: Date.now(),
  });

  // Auto-generate .kuma/init.md (behavioral rules) if missing
  (async () => {
    try {
      const { generateInitMdContent } = await import("./cli/init.js");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const initMdPath = path.resolve(process.cwd(), ".kuma/init.md");
      if (!fs.existsSync(initMdPath)) {
        const kumaDir = path.dirname(initMdPath);
        if (!fs.existsSync(kumaDir)) fs.mkdirSync(kumaDir, { recursive: true });
        fs.writeFileSync(initMdPath, generateInitMdContent(), "utf-8");
        console.error(`[${SERVER_NAME}] Auto-generated .kuma/init.md`);
      }
    } catch (err) {
      console.error(`[${SERVER_NAME}] Failed to auto-generate .kuma/init.md: ${err}`);
    }
  })();

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  registerAllTools(server);

  const transport = new StdioServerTransport();
  console.error(`[${SERVER_NAME} v${SERVER_VERSION}] Starting MCP server...`);
  console.error(`[${SERVER_NAME}] Project root: ${process.cwd()}`);
  console.error(
    `[${SERVER_NAME}] Session started: ${new Date().toISOString()}`,
  );
  console.error(
    `[${SERVER_NAME}] Kuma Core v3 — .kuma/init.md is the single source of truth`,
  );
  console.error(
    `[${SERVER_NAME}] 🧠 Call kuma_init() at session start to load project context`,
  );

  await server.connect(transport);

  console.error(
    `[${SERVER_NAME}] Server connected via stdio. Waiting for requests...`,
  );
}

/**
 * Interactive prompt: ask user which config files to generate.
 * Uses Node.js readline for robust input handling.
 */
function interactiveSelect(): Promise<ConfigType[]> {
  const labels = [
    { type: "claude" as ConfigType, label: "1) Claude Code (CLAUDE.md)" },
    {
      type: "cursor" as ConfigType,
      label: "2) Cursor (.cursor/rules/kuma.mdc)",
    },
    { type: "windsurf" as ConfigType, label: "3) Windsurf (.windsurfrules)" },
    {
      type: "copilot" as ConfigType,
      label: "4) GitHub Copilot Editor (AGENTS.md + Skill)",
    },
    { type: "cline" as ConfigType, label: "5) Cline (.clinerules/kuma.md)" },
    {
      type: "aider" as ConfigType,
      label: "6) Aider (CONVENTIONS.md via .aider.conf.yml)",
    },
    {
      type: "antigravity" as ConfigType,
      label: "7) Antigravity CLI (.agents/skills/)",
    },
    { type: "opencode" as ConfigType, label: "8) OpenCode (opencode.json)" },
    {
      type: "codex" as ConfigType,
      label: "9) Codex CLI - OpenAI (AGENTS.md + .codex/config.toml)",
    },
    {
      type: "qwen" as ConfigType,
      label: "10) Qwen Code (AGENTS.md + settings.json)",
    },
    { type: "kiro" as ConfigType, label: "11) Kiro (.kiro/steering/kuma.md)" },
    {
      type: "openclaw" as ConfigType,
      label: "12) OpenClaw (skills/kuma/SKILL.md)",
    },
    {
      type: "codewhale" as ConfigType,
      label: "13) CodeWhale (skills/kuma/SKILL.md + .codewhale/mcp.json)",
    },
  ];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    console.error("");
    for (const l of labels) {
      console.error(l.label);
    }
    console.error("");

    rl.question(
      "Enter numbers separated by space (e.g. '1 3 5'), or 'all': ",
      (answer) => {
        rl.close();
        const input = answer.trim().toLowerCase();

        if (input === "all") {
          resolve(ALL_CONFIG_TYPES);
          return;
        }

        const nums = input
          .split(/\s+/)
          .map(Number)
          .filter((n) => n >= 1 && n <= 13);
        const typeMap: Record<number, ConfigType> = {
          1: "claude",
          2: "cursor",
          3: "windsurf",
          4: "copilot",
          5: "cline",
          6: "aider",
          7: "antigravity",
          8: "opencode",
          9: "codex",
          10: "qwen",
          11: "kiro",
          12: "openclaw",
          13: "codewhale",
        };

        const selected: ConfigType[] = [];
        for (const n of nums) {
          const t = typeMap[n];
          if (t && !selected.includes(t)) {
            selected.push(t);
          }
        }
        resolve(selected);
      },
    );
  });
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, err);
  process.exit(1);
});
