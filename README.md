<div align="center">

<img src="https://raw.githubusercontent.com/plumpslabs/kuma/main/public/kuma.png" alt="Kuma Logo" width="200" />

# Kuma

**Zero-setup safety toolkit for AI coding agents.**

[![npm](https://img.shields.io/npm/v/@plumpslabs/kuma.svg?logo=npm&color=red)](https://www.npmjs.com/package/@plumpslabs/kuma)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-18+-339933?logo=nodedotjs)](https://nodejs.org/)

Works with **Claude Code**, **Cursor**, **Gemini CLI**, **GitHub Copilot**, and any MCP-compatible client.

</div>

---

## Quick Start

Add to your MCP client config:

```json
{
  "mcpServers": {
    "kuma": {
      "command": "npx",
      "args": ["-y", "@plumpslabs/kuma"]
    }
  }
}
```


<details>
<summary><b>Where does this config go?</b></summary>

| Client | Config Location |
|--------|----------------|
| **Claude Code** | `~/.claude/settings.json` |
| **Cursor** | Settings → Features → MCP → Add Server |
| **Gemini CLI** | `~/.gemini/settings.json` |
| **Copilot / Codex** | VS Code MCP extension settings |

</details>

---

## Kuma's Promise

**Kuma is built for one thing: making sure AI agents don't break your project.**

Every tool in Kuma has a safety net built-in — not as an afterthought, but as a core design principle. Here's what Kuma guarantees:

| # | When this happens... | Kuma does this... |
|---|---|---|
| 1 | LSP server is not installed | **Falls back to regex** — never hard fails |
| 2 | An edit breaks something | **Rollback to any version** — versioned backups |
| 3 | AI loops on a test failure | **Circuit breaker stops it** — prevents infinite retries |
| 4 | A file path doesn't resolve | **Shows where it looked** — CWD vs project root |
| 5 | A command is dangerous | **Blocks it** — `rm -rf`, `git push --force`, `curl \| bash` |

Most tools make AI smarter. **Kuma makes AI not break things.**

---

## Tools (16)

### 🔍 Context — Understand the codebase

| Tool | Description |
|------|-------------|
| `smart_grep` | Search code with regex. Returns filename, line, and context. Caches results. |
| `smart_file_picker` | Read files with smart chunking: `full` (entire file), `smart` (signatures + tail), `outline` (exports only). |
| `project_structure` | Tree view of project layout. Depth control, folder-only mode, include/exclude patterns. |
| `git_log` | Structured commit history with optional file filter. |
| `git_diff` | Structured diff output. Supports staged/unstaged, file filter, ref ranges. |
| `lsp_query` | Go-to-definition, find references, get type info, or rename symbols via TypeScript Language Server. **Falls back to regex when LSP unavailable.** |
| `project_conventions` | Auto-detect framework, test runner, package manager, import aliases, **monorepo workspaces**. |

### ✏️ Execution — Make changes safely

| Tool | Description |
|------|-------------|
| `precise_diff_editor` | Search-and-replace with exact → whitespace → fuzzy fallback. **Auto-backup before every edit.** Use `action: "rollback"` to undo. |
| `batch_file_writer` | Create up to 15 files in one call. Validates paths before writing. |
| `static_analysis` | Run ESLint / TypeScript / Prettier / Ruff and **parse output into structured results.** Auto-detects tools from project config. |

### 🧪 Validation — Verify before breaking

| Tool | Description |
|------|-------------|
| `execute_safe_test` | Run `test`/`build`/`lint`/`typecheck` with **timeout, circuit breaker, and process tree kill.** |
| `code_reviewer` | Senior-level static analysis. Focus modes: correctness, conventions, security, performance, and **over-engineering detection.** |

### 🧠 Memory — Know what happened

| Tool | Description |
|------|-------------|
| `get_session_memory` | Session state tracker. Shows modified files, unresolved failures, tool history. Load specific memory topics with `{ topic }`. |
| `search_session_memory` | **Keyword search** across tool calls, memory files, errors, modified files, and dependency graph. |
| `write_memory` | Persist project knowledge (decisions, glossary) to `.kuma/memories/`. Append, prepend, or overwrite. |
| `kuma_reflect` | **Reflection tool** — checks if you're on track, detects drift (edits without tests, loops, unresolved failures), and suggests the next action. |

---

## Safety

| Feature | What it does |
|---------|-------------|
| **Sandboxed** | All file operations locked to project directory. Path traversal blocked. System dirs protected. |
| **Auto-backup** | `.agent-backups/<timestamp>/` snapshot before every edit. Rollback to any version. |
| **Circuit breaker** | Stops after 3 identical failures. Prevents AI loops. |
| **Timeout** | All commands have configurable timeout (max 180s). Process tree kill on timeout. |
| **Command whitelist** | Only `test`, `build`, `lint`, `typecheck`, and explicit custom commands. |
| **Dangerous pattern blocking** | `rm -rf`, `git push --force`, `npm publish`, `curl \| bash` blocked by default. |
| **LSP graceful degradation** | When TypeScript Language Server is not installed, LSP tools **fall back to regex** instead of hard failing. |

---

## What Makes Kuma Unique

- **Workflow combo** — `project_conventions + smart_grep + smart_file_picker + precise_diff_editor + execute_safe_test + code_reviewer` as a seamless pipeline.
- **Safety is default, not optional** — Rollback, circuit breaker, sandbox, timeout, dangerous pattern blocking are built into every tool.
- **Graceful degradation** — When dependencies are missing (LSP, linters), Kuma falls back instead of crashing.
- **Over-engineering detection** — `code_reviewer` with `focus: "over-engineering"` catches unnecessary abstractions.
- **Drift detection** — `kuma_reflect` catches edits without tests, tool-call loops, unresolved failures.
- **Persistent memory** — Knowledge survives across sessions via `.kuma/memories/`. Auto-generates architecture & conventions docs.
- **Monorepo awareness** — Detects workspaces, scans `apps/*`, `packages/*`, `services/*`, and pnpm/yarn/npm workspaces.

---

## Kuma's DNA

1. **Zero setup, zero friction** — Built-in tools that work without config. No DB, no API key.
2. **Safety first** — Every tool has a safety net: timeout, circuit breaker, rollback, sandbox.
3. **Graceful degradation, not crash** — Every tool has a fallback before it fails. LSP unavailable? Regex. File not found? Show resolved paths. Diff mismatch? Whitespace→fuzzy retry. Test fails? Circuit breaker stops the loop.
4. **Opinionated workflow** — Tools designed to be used together: `conventions → grep → pick → diff → test → review`.
5. **Minimal surface** — 16 focused tools. Each tool has one job and does it well. No overlap, no confusion.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## License

[MIT](LICENSE)

<div align="center">

**Made with 🐻 for AI agents everywhere**

[Report Bug](https://github.com/farhank15/kuma/issues) · [Request Feature](https://github.com/farhank15/kuma/issues)

</div>
