import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { handleSmartGrep } from "./tools/smartGrep.js";
import { handleSmartFilePicker } from "./tools/smartFilePicker.js";
import { handlePreciseDiffEditor } from "./tools/preciseDiffEditor.js";
import { handleBatchFileWriter } from "./tools/batchFileWriter.js";
import { handleSafeTerminalExec } from "./tools/safeTerminalExec.js";
import { handleCodeReviewer } from "./agents/codeReviewer.js";
import { handleProjectConventions } from "./agents/projectConventions.js";
import { handleGitLog } from "./tools/gitLog.js";
import { handleGitDiff } from "./tools/gitDiff.js";
import { handleProjectStructure } from "./tools/projectStructure.js";
import { handleStaticAnalysis } from "./tools/staticAnalysis.js";
import { handleReflect } from "./tools/kumaReflect.js";
import { handleKumaGuard } from "./tools/kumaGuard.js";
import { handleKumaContext } from "./tools/kumaContext.js";

import { getSessionMemory, handleWriteMemory, searchSessionMemory, MemoryTopic } from "./engine/sessionMemory.js";

import { handleLspQuery } from "./tools/lspTools.js";

const MEMORY_TOPICS = ["decisions", "glossary", "architecture", "conventions", "known-issues"] as const;

export function registerAllTools(server: McpServer): void {
  // 1. smart_grep
  server.tool(
    "smart_grep",
    "Narrow down to the specific code you need. Locates functions or text patterns — returns filename, line number, and 3 lines of context.",
    {
      query: z.string({ invalid_type_error: 'smart_grep: "query" must be a string regex pattern.\n\n✅ Example: { query: "function handleUser" }' }).min(1).describe("Regex pattern to search for. Example: 'function handleAuth' or 'console\\.log'"),
      targetFolder: z.string().optional().describe("Target folder (default: project root, max depth 3)"),
      maxResults: z.number().min(1).max(100).optional().default(30).describe("Max results to return"),
      extensions: z.array(z.string()).optional().describe("Filter results by file extensions (e.g. ['ts', 'js'])"),
    },
    async (params) => {
      try {
        const result = await handleSmartGrep(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in smart_grep: ${err}` }], isError: true };
      }
    }
  );

  // 2. smart_file_picker
  server.tool(
    "smart_file_picker",
    "Read only what you need. Opens a file with smart chunking — signatures + imports for large files, full content for small ones.",
    {
      filePath: z.string().min(1).describe("Path to the file to read"),
      startLine: z.number().min(1).optional().describe("Start line (1-indexed)"),
      endLine: z.number().min(1).optional().describe("End line (1-indexed)"),
      chunkStrategy: z.enum(["full", "smart", "outline"]).optional().default("smart").describe("Read strategy: full=entire file, smart=signatures+imports, outline=exported symbols only"),
    },
    async (params) => {
      try {
        const result = await handleSmartFilePicker(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in smart_file_picker: ${err}` }], isError: true };
      }
    }
  );

  // 3. precise_diff_editor (includes rollback via action param)
  server.tool(
    "precise_diff_editor",
    "Edit code with safety net. Search-and-replace with fuzzy fallback + automatic versioned backup. Use action:'rollback' to undo edits.",
    {
      filePath: z.string({ invalid_type_error: 'precise_diff_editor: "filePath" must be a string path relative to project root.\n\n✅ Example: "src/example.ts"' }).min(1).describe("Path to the file to edit"),
      action: z.enum(["rollback"]).optional().describe("Set to 'rollback' to restore from backup. Only use when restoring from backup."),
      edits: z.array(z.object({
        searchBlock: z.string({ invalid_type_error: '"searchBlock" must be a string of the exact code to replace' }).min(1).describe("Code block to replace (MUST be exact or fuzzy match)"),
        replaceBlock: z.string({ invalid_type_error: '"replaceBlock" must be a string of the replacement code' }).describe("Replacement code block"),
        allowMultiple: z.boolean().optional().default(false).describe("Allow multiple replacements"),
        fuzzyThreshold: z.number().min(0).max(1).optional().default(0.85).describe("Fuzzy match threshold (0.0-1.0)"),
      }), {
        invalid_type_error: 'precise_diff_editor: "edits" must be an ARRAY of { searchBlock, replaceBlock } objects.\n\n✅ Correct format:\n{\n  edits: [\n    { searchBlock: "old code", replaceBlock: "new code" }\n  ]\n}',
      }).min(1).max(10).optional().describe("Array of edits (max 10). Each edit has: searchBlock (code to find), replaceBlock (new code)"),
      dryRun: z.boolean().optional().default(false).describe("Preview changes without writing to disk. Set dryRun: true to preview first."),
      version: z.union([z.number().min(1), z.literal('list')]).optional().describe("Backup version to restore (1=newest, omit=latest, 'list'=show versions)"),
    },
    async (params) => {
      try {
        const result = await handlePreciseDiffEditor(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in precise_diff_editor: ${err}` }], isError: true };
      }
    }
  );

  // 4. batch_file_writer
  server.tool(
    "batch_file_writer",
    "Create files in batch (up to 15). Before creating many, question whether each one needs to exist or could be merged into an existing module.",
    {
      files: z.array(z.object({
        filePath: z.string().min(1).describe("File path to create"),
        content: z.string().describe("File content"),
        instructions: z.string().min(1).describe("Reason for creating the file"),
      }), {
        invalid_type_error: 'batch_file_writer: "files" must be an ARRAY of objects.\n\n✅ Correct format:\n{\n  files: [\n    { filePath: "src/example.ts", content: "// code", instructions: "reason" }\n  ]\n}',
        required_error: 'batch_file_writer: "files" is required.\n\n✅ Correct format:\n{\n  files: [\n    { filePath: "src/example.ts", content: "// code", instructions: "reason" }\n  ]\n}',
      }).min(1).max(15).describe("Array of files to create (max 15). Example: [{ filePath: 'src/x.ts', content: '...', instructions: 'why' }]"),
    },
    async (params) => {
      try {
        const result = await handleBatchFileWriter(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in batch_file_writer: ${err}` }], isError: true };
      }
    }
  );

  // 5. execute_safe_test
  server.tool(
    "execute_safe_test",
    "Run tests, lint, or typecheck with timeout protection and circuit breaker. Supports monorepo workspaces via 'workspace' or relative 'cwd'. Use after every edit to verify you didn't break anything.",
    {
      task: z.enum(["test", "build", "lint", "typecheck", "custom"]).describe("Task to execute: test, build, lint, typecheck, or custom"),
      customCommand: z.string({ invalid_type_error: '"customCommand" must be a string command like "npm run my-script"' }).optional().describe("Custom command (required only if task='custom')"),
      timeout: z.number({ invalid_type_error: '"timeout" must be a number in seconds (5-180)' }).min(5).max(180).optional().default(60).describe("Timeout in seconds (default: 60s, max: 180s)"),
      cwd: z.string().optional().describe("Relative directory from project root (e.g. 'packages/web'). Defaults to project root."),
      workspace: z.string().optional().describe("Workspace name from project_conventions (e.g. 'frontend', 'api'). Auto-resolves to path."),
    },
    async (params) => {
      try {
        const result = await handleSafeTerminalExec(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in execute_safe_test: ${err}` }], isError: true };
      }
    }
  );

  // 6. code_reviewer
  server.tool(
    "code_reviewer",
    "Senior code review that catches what the writer missed. Supports focus modes: correctness, conventions, security, performance, and over-engineering.",
    {
      files: z.array(z.string().min(1)).max(10).optional().describe("Files to review (auto-detects via git diff if omitted)"),
      focus: z.enum(["correctness", "conventions", "security", "performance", "over-engineering"]).optional().default("correctness").describe("Review focus"),
      customCriteria: z.string().optional().describe("Custom review criteria"),
      format: z.enum(["text", "json"]).optional().default("text").describe("Output format"),
    },
    async (params) => {
      try {
        const result = await handleCodeReviewer(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in code_reviewer: ${err}` }], isError: true };
      }
    }
  );

  // 7. project_conventions
  server.tool(
    "project_conventions",
    "Know your stack before you code. Detects framework, test runner, package manager, import alias, monorepo workspaces.",
    {
      forceRescan: z.boolean().optional().default(false).describe("Force rescan (ignore cache)"),
    },
    async (params) => {
      try {
        const result = await handleProjectConventions(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in project_conventions: ${err}` }], isError: true };
      }
    }
  );

  // 8. get_session_memory
  server.tool(
    "get_session_memory",
    "Check what you've done this session: modified files, unresolved failures, tool history, memories. Accepts optional topic to load a specific memory file.",
    {
      topic: z.enum(MEMORY_TOPICS).optional().describe("Load a specific memory topic: decisions, glossary, architecture, conventions, known-issues. Example: { topic: 'decisions' }"),
    },
    async (params) => {
      try {
        const memory = getSessionMemory(params.topic as MemoryTopic | undefined);
        return { content: [{ type: "text", text: JSON.stringify(memory, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error getting session memory: ${err}` }], isError: true };
      }
    }
  );

  // 9. lsp_query (includes rename via action:'rename')
  server.tool(
    "lsp_query",
    "Jump to definition, find references, inspect types, or rename symbols. Uses TypeScript Language Server — falls back to regex when LSP is unavailable.",
    {
      filePath: z.string({ invalid_type_error: 'lsp_query: "filePath" must be a string path.\n\n✅ Example: { filePath: "src/index.ts", line: 10, character: 5, action: "def" }' }).min(1).describe("Path to the file containing the symbol"),
      line: z.number({ invalid_type_error: '"line" must be a number (0-indexed). Line 0 = first line.' }).min(0).describe("Line number (0-indexed)"),
      character: z.number({ invalid_type_error: '"character" must be a number (0-indexed). Position within the line.' }).min(0).describe("Character position (0-indexed)"),
      action: z.enum(["def", "refs", "type", "rename"]).describe("Action: def=go to definition, refs=find references, type=get type info, rename=rename symbol"),
      newName: z.string().optional().describe("New name (required for action:'rename'). Example: { action: 'rename', newName: 'newFunctionName' }"),
    },
    async (params) => {
      try {
        const result = await handleLspQuery(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in lsp_query: ${err}` }], isError: true };
      }
    }
  );

  // 10. git_log
  server.tool(
    "git_log",
    "Gets structured git commit history for the project or a specific file.",
    {
      maxCount: z.number().min(1).max(100).optional().default(10).describe("Max number of commits to return"),
      filePath: z.string().optional().describe("Filter history to a specific file"),
    },
    async (params) => {
      try {
        const result = await handleGitLog(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in git_log: ${err}` }], isError: true };
      }
    }
  );

  // 11. kuma_reflect
  server.tool(
    "kuma_reflect",
    "Reflect on your current session: on-track/off-track detection, drift warnings, loop detection, and a concrete suggestion for the next action.",
    {
      goal: z.string().optional().describe("Optional goal to check against (falls back to session goal)"),
    },
    async (params) => {
      try {
        const result = await handleReflect(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_reflect: ${err}` }], isError: true };
      }
    }
  );

  // 12. write_memory
  server.tool(
    "write_memory",
    "Persist project knowledge to `.kuma/memories/`. Use for decisions (ADR) and glossary (domain terms). Auto-generated topics (architecture, conventions, known-issues) update automatically.",
    {
      topic: z.enum(["decisions", "glossary"]).describe("Memory topic: 'decisions' (ADR) or 'glossary' (domain terms)"),
      content: z.string().min(1).describe("Markdown content to write"),
      mode: z.enum(["append", "prepend", "overwrite"]).optional().default("append").describe("Write mode: append (default), prepend, or overwrite"),
    },
    async (params) => {
      try {
        const result = handleWriteMemory(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in write_memory: ${err}` }], isError: true };
      }
    }
  );

  // 13. git_diff
  server.tool(
    "git_diff",
    "Shows structured git diff output (staged or unstaged). Supports file filter, ref ranges, and context line control.",
    {
      filePath: z.string().optional().describe("Filter diff to a specific file"),
      staged: z.boolean().optional().default(false).describe("Show staged changes (--cached)"),
      contextLines: z.number().min(1).max(20).optional().default(3).describe("Number of context lines per chunk"),
      baseRef: z.string().optional().describe("Base git ref for comparing (e.g. main, HEAD~1)"),
      targetRef: z.string().optional().describe("Target git ref (defaults to HEAD if baseRef is set)"),
    },
    async (params) => {
      try {
        const result = await handleGitDiff(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in git_diff: ${err}` }], isError: true };
      }
    }
  );

  // 14. project_structure
  server.tool(
    "project_structure",
    "Displays a tree view of the project's directory layout. Helps AI understand where files live before reading or editing.",
    {
      depth: z.number().min(1).max(6).optional().default(3).describe("Max directory depth to show (1-6)"),
      folderOnly: z.boolean().optional().default(false).describe("Show folders only (no files)"),
      includePattern: z.string().optional().describe("Only show items containing this string"),
      excludePattern: z.string().optional().describe("Exclude items containing this string"),
    },
    async (params) => {
      try {
        const result = await handleProjectStructure(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in project_structure: ${err}` }], isError: true };
      }
    }
  );

  // 15. search_session_memory
  server.tool(
    "search_session_memory",
    "Search through session memory by keyword. Covers tool call history, memory files, errors, modified files, and search results.",
    {
      query: z.string().min(1).describe("Keyword to search for in session memory"),
      limit: z.number().min(1).max(100).optional().default(20).describe("Maximum results to return"),
    },
    async (params) => {
      try {
        const result = searchSessionMemory(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in search_session_memory: ${err}` }], isError: true };
      }
    }
  );

  // 16. kuma_guard
  server.tool(
    "kuma_guard",
    "Context safety net. Checks for anti-patterns (script patching, bash grep), loops, drift (edits without tests, unresolved failures). Run this after every few edits to stay on track.",
    {
      check: z.enum(["all", "anti-pattern", "loop", "drift", "context"]).optional().default("all").describe("Check type: all=everything, anti-pattern=script/grep detection, loop=loop detection, drift=edit vs test balance"),
      goal: z.string({ invalid_type_error: 'kuma_guard: "goal" must be a string describing what you are working on.\n\n✅ Example: { goal: "refactor auth module" }' }).optional().describe("Optional goal to check against. Example: 'refactor auth module'"),
    },
    async (params) => {
      try {
        const result = await handleKumaGuard(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_guard: ${err}` }], isError: true };
      }
    }
  );

  // 17. static_analysis
  server.tool(
    "static_analysis",
    "Runs available linters/checkers (ESLint, TypeScript, Prettier, Ruff) and parses output into structured results. Auto-detects tools from project config.",
    {
      tool: z.enum(["eslint", "tsc", "prettier", "ruff", "all"]).optional().default("all").describe("Which tool to run (default: auto-detect all available)"),
      files: z.array(z.string()).optional().describe("Specific files to check (default: whole project)"),
      autoFix: z.boolean().optional().default(false).describe("Auto-fix fixable issues (eslint --fix, prettier --write)"),
      timeout: z.number().min(5).max(180).optional().default(60).describe("Timeout in seconds per tool"),
    },
    async (params) => {
      try {
        const result = await handleStaticAnalysis(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in static_analysis: ${err}` }], isError: true };
      }
    }
  );

  // 18. kuma_context
  server.tool(
    "kuma_context",
    "Context snapshot manager. Save a snapshot of current project state (modified files, errors, git diff) or list previous snapshots. Run this before risky operations to have a restore point.",
    {
      action: z.enum(["save", "list"]).describe("Action: save=create a snapshot, list=show all snapshots"),
      goal: z.string().optional().describe("Optional goal to associate with the snapshot"),
    },
    async (params) => {
      try {
        const result = await handleKumaContext(params);
        return { content: [{ type: "text", text: result }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Error in kuma_context: ${err}` }], isError: true };
      }
    }
  );

  console.error("[Manifest] Registered 17 tools.");
}
