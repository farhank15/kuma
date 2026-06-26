import fs from "node:fs";
import path from "node:path";

// ============================================================
// SESSION MEMORY — State tracker & Knowledge graph mini proyek
// ============================================================

const MEMORY_TOPICS = ["decisions", "glossary", "architecture", "conventions", "known-issues"] as const;
export type MemoryTopic = typeof MEMORY_TOPICS[number];



interface ToolCallRecord {
  toolName: string;
  params: Record<string, unknown>;
  timestamp: number;
}

interface FileModification {
  filePath: string;
  modifiedAt: number;
  status: "modified" | "created" | "failed";
  error?: string;
}

interface TestFailure {
  task: string;
  error: string;
  timestamp: number;
  resolved: boolean;
}

interface SessionState {
  projectRoot: string;
  startTime: number;
  currentGoal: string;
  completedSteps: string[];
  modifiedFiles: Map<string, FileModification>;
  failedFiles: Map<string, TestFailure[]>;
  searchResults: Map<string, string[]>; // query -> file paths
  dependencyGraph: Map<string, string[]>; // file -> depends on
  toolCalls: ToolCallRecord[];
  conventions?: Record<string, unknown>;
}

/** @internal exported for testing */
export class SessionMemory {
  private state!: SessionState;
  private initialized = false;

  init(config: { projectRoot: string; startTime: number }): void {
    const kumaDir = path.join(config.projectRoot, ".kuma");
    const sessionFile = path.join(kumaDir, "memory.json");

    // Migration: .kuma-memory.json → memory.json (v1.4.0)
    const oldFile = path.join(kumaDir, ".kuma-memory.json");
    if (fs.existsSync(oldFile) && !fs.existsSync(sessionFile)) {
      try {
        fs.renameSync(oldFile, sessionFile);
        console.error('[SessionMemory] Migrated .kuma-memory.json → memory.json');
      } catch {}
    }

    // Migration: session.json → memory.json
    const oldSessionFile = path.join(kumaDir, "session.json");
    if (fs.existsSync(oldSessionFile) && !fs.existsSync(sessionFile)) {
      try {
        fs.renameSync(oldSessionFile, sessionFile);
        console.error('[SessionMemory] Migrated session.json → memory.json');
      } catch {}
    }

    if (fs.existsSync(sessionFile)) {
      try {
        const raw = fs.readFileSync(sessionFile, "utf-8");
        const parsed = JSON.parse(raw);
        this.state = {
          projectRoot: parsed.projectRoot || config.projectRoot,
          startTime: parsed.startTime || config.startTime,
          currentGoal: parsed.currentGoal || "",
          completedSteps: parsed.completedSteps || [],
          modifiedFiles: new Map(parsed.modifiedFiles || []),
          failedFiles: new Map(parsed.failedFiles || []),
          searchResults: new Map(parsed.searchResults || []),
          dependencyGraph: new Map(parsed.dependencyGraph || []),
          toolCalls: parsed.toolCalls || [],
          conventions: parsed.conventions,
        };
        this.initialized = true;
        console.error(`[SessionMemory] Loaded persistent session memory.json`);
        return;
      } catch (err) {
        console.error(`[SessionMemory] Failed to load persistent session: ${err}. Re-initializing.`);
      }
    }

    this.state = {
      projectRoot: config.projectRoot,
      startTime: config.startTime,
      currentGoal: "",
      completedSteps: [],
      modifiedFiles: new Map(),
      failedFiles: new Map(),
      searchResults: new Map(),
      dependencyGraph: new Map(),
      toolCalls: [],
    };
    this.initialized = true;
    this.save();
    this.ensureMemoriesDir();
    console.error(`[SessionMemory] Initialized at ${new Date(config.startTime).toISOString()}`);
  }

  private memoriesDir(): string {
    return path.join(this.state.projectRoot, ".kuma", "memories");
  }

  private ensureMemoriesDir(): void {
    const dir = this.memoriesDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private memoryFilePath(topic: MemoryTopic): string {
    return path.join(this.memoriesDir(), `${topic}.md`);
  }

  getMemoryContent(topic: MemoryTopic): string {
    this.ensureInit();
    this.ensureMemoriesDir();
    const filePath = this.memoryFilePath(topic);

    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }

    return this.generateMemory(topic);
  }

  writeMemory(topic: MemoryTopic, content: string): void {
    this.ensureInit();
    this.ensureMemoriesDir();
    this.writeMemoryFile(topic, content);
  }

  private writeMemoryFile(topic: MemoryTopic, content: string): void {
    const filePath = this.memoryFilePath(topic);
    fs.writeFileSync(filePath, content, "utf-8");
  }

  private generateMemory(topic: MemoryTopic): string {
    switch (topic) {
      case "architecture":
        return this.generateArchitectureMd();
      case "conventions":
        return this.generateConventionsMd();
      case "known-issues":
        return this.generateKnownIssuesMd();
      default:
        return `# ${topic}\n\n(empty)`;
    }
  }

  private generateArchitectureMd(): string {
    const conv = this.state.conventions;
    if (!conv) return `# Architecture\n\nRun project_conventions first to auto-generate.`;

    const stackKeys = ["framework", "projectType", "monorepo", "buildTool", "packageManager"];
    const lines: string[] = [
      "# Architecture",
      "",
      `Generated at ${new Date().toISOString()}`,
      "",
      "## Stack",
      "",
    ];
    for (const key of stackKeys) {
      if (conv[key] !== undefined) {
        lines.push(`- **${key}**: ${JSON.stringify(conv[key])}`);
      }
    }
    lines.push("", "## Project Layout", "");
    if (conv.workspaces) {
      lines.push(`- Monorepo workspaces: ${JSON.stringify(conv.workspaces)}`);
    }
    lines.push(`- Source root: ${conv.srcDir || "src/"}`);
    return lines.join("\n");
  }

  private generateConventionsMd(): string {
    const conv = this.state.conventions;
    if (!conv) return `# Conventions\n\nRun project_conventions first to auto-generate.`;

    const styleKeys = ["testRunner", "styling", "importAlias", "lintConfig", "codeStyle"];
    const lines: string[] = [
      "# Conventions",
      "",
      `Generated at ${new Date().toISOString()}`,
      "",
      "## Code Style",
      "",
    ];
    for (const key of styleKeys) {
      if (conv[key] !== undefined) {
        lines.push(`- **${key}**: ${JSON.stringify(conv[key])}`);
      }
    }
    if (conv.testRunner) {
      lines.push("", `## Testing\n\n- Test runner: ${conv.testRunner}`);
    }
    if (conv.importAlias) {
      lines.push("", `## Imports\n\n- Alias: \`${conv.importAlias}\``);
    }
    return lines.join("\n");
  }

  private generateKnownIssuesMd(): string {
    const allFailures = this.getFailedFiles();
    const unresolved = allFailures.filter(f => f.failures.some(ff => !ff.resolved));
    if (unresolved.length === 0) return `# Known Issues\n\nNo unresolved issues.`;
    const lines: string[] = [
      "# Known Issues",
      "",
      `Generated at ${new Date().toISOString()}`,
      "",
    ];
    for (const f of unresolved) {
      lines.push(`## ${f.task}`);
      for (const ff of f.failures) {
        if (!ff.resolved) {
          lines.push(`- ${new Date(ff.timestamp).toISOString()}: ${ff.error}`);
        }
      }
      lines.push("");
    }
    return lines.join("\n");
  }


  private save(): void {
    if (!this.initialized || !this.state) return;
    try {
      const kumaDir = path.join(this.state.projectRoot, ".kuma");
      if (!fs.existsSync(kumaDir)) {
        fs.mkdirSync(kumaDir, { recursive: true });
      }
      const serialized = {
        projectRoot: this.state.projectRoot,
        startTime: this.state.startTime,
        currentGoal: this.state.currentGoal,
        completedSteps: this.state.completedSteps,
        modifiedFiles: Array.from(this.state.modifiedFiles.entries()),
        failedFiles: Array.from(this.state.failedFiles.entries()),
        searchResults: Array.from(this.state.searchResults.entries()),
        dependencyGraph: Array.from(this.state.dependencyGraph.entries()),
        toolCalls: this.state.toolCalls,
        conventions: this.state.conventions,
      };
      fs.writeFileSync(path.join(kumaDir, "memory.json"), JSON.stringify(serialized, null, 2), "utf-8");
    } catch (err) {
      console.error(`[SessionMemory] Failed to save session: ${err}`);
    }
  }

  setGoal(goal: string): void {
    this.ensureInit();
    this.state.currentGoal = goal;
    this.save();
  }

  addCompletedStep(step: string): void {
    this.ensureInit();
    if (!this.state.completedSteps.includes(step)) {
      this.state.completedSteps.push(step);
      this.save();
    }
  }

  addModifiedFile(filePath: string): void {
    this.ensureInit();
    const existing = this.state.modifiedFiles.get(filePath);
    if (existing) {
      existing.modifiedAt = Date.now();
      existing.status = "modified";
    } else {
      this.state.modifiedFiles.set(filePath, {
        filePath,
        modifiedAt: Date.now(),
        status: "modified",
      });
    }
    this.save();
  }

  addCreatedFile(filePath: string): void {
    this.ensureInit();
    this.state.modifiedFiles.set(filePath, {
      filePath,
      modifiedAt: Date.now(),
      status: "created",
    });
    this.save();
  }

  addFailedFile(task: string, error: string): void {
    this.ensureInit();
    const trimmedError = error?.trim() ?? "";
    if (!trimmedError) return;

    const truncatedError = trimmedError.substring(0, 500);
    const failures = this.state.failedFiles.get(task) ?? [];

    const lastUnresolved = [...failures].reverse().find((f) => !f.resolved);
    if (lastUnresolved && lastUnresolved.error === truncatedError) return;

    failures.push({
      task,
      error: truncatedError,
      timestamp: Date.now(),
      resolved: false,
    });
    this.state.failedFiles.set(task, failures);
    this.save();
    this.ensureMemoriesDir();
    this.writeMemoryFile("known-issues", this.generateKnownIssuesMd());
  }

  markFailureResolved(task: string): void {
    this.ensureInit();
    const failures = this.state.failedFiles.get(task);
    if (failures) {
      let changed = false;
      for (const f of failures) {
        if (!f.resolved) {
          f.resolved = true;
          changed = true;
        }
      }
      if (changed) {
        this.save();
        this.ensureMemoriesDir();
        this.writeMemoryFile("known-issues", this.generateKnownIssuesMd());
      }
    }
  }

  addSearchResult(query: string, files: string[]): void {
    this.ensureInit();
    this.state.searchResults.set(query, files);
    this.save();
  }

  addDependency(file: string, dependsOn: string): void {
    this.ensureInit();
    const deps = this.state.dependencyGraph.get(file) ?? [];
    if (!deps.includes(dependsOn)) {
      deps.push(dependsOn);
      this.state.dependencyGraph.set(file, deps);
      this.save();
    }
  }

  recordToolCall(toolName: string, params: Record<string, unknown>): void {
    this.ensureInit();
    this.state.toolCalls.push({
      toolName,
      params,
      timestamp: Date.now(),
    });

    // Keep only last 100 tool calls (prevent memory leak)
    if (this.state.toolCalls.length > 100) {
      this.state.toolCalls = this.state.toolCalls.slice(-100);
    }
    this.save();
  }

  setConventions(conventions: Record<string, unknown>): void {
    this.ensureInit();
    this.state.conventions = conventions;
    this.save();
    this.ensureMemoriesDir();
    this.writeMemoryFile("architecture", this.generateArchitectureMd());
    this.writeMemoryFile("conventions", this.generateConventionsMd());
  }

  // ============================================================
  // KEYWORD SEARCH — Search session memory content
  // ============================================================

  /**
   * Load previous session data into current session.
   * Called by kuma_init() to hydrate conventions, failures, and modified files
   * from a prior session stored in memory.json.
   */
  loadSession(): { hasPrevSession: boolean; toolCallCount: number; hasConventions: boolean } {
    this.ensureInit();
    const kumaDir = path.join(this.state.projectRoot, ".kuma");
    const sessionFile = path.join(kumaDir, "memory.json");

    if (!fs.existsSync(sessionFile)) {
      return { hasPrevSession: false, toolCallCount: 0, hasConventions: !!this.state.conventions };
    }

    try {
      const raw = fs.readFileSync(sessionFile, "utf-8");
      const parsed = JSON.parse(raw);

      // Restore conventions if current session doesn't have them
      if (!this.state.conventions && parsed.conventions) {
        this.state.conventions = parsed.conventions;
      }

      // Restore unresolved failures
      const prevFailed = parsed.failedFiles as Array<[string, Array<{ task: string; error: string; timestamp: number; resolved: boolean }>]> | undefined;
      if (prevFailed) {
        for (const [task, failures] of prevFailed) {
          for (const f of failures) {
            if (!f.resolved) {
              const existing = this.state.failedFiles.get(task);
              if (!existing?.some(ef => ef.error === f.error)) {
                this.state.failedFiles.set(task, [...(existing || []), f]);
              }
            }
          }
        }
      }

      // Restore modified files (for context, not for re-applying)
      const prevModified = parsed.modifiedFiles as Array<[string, { filePath: string; modifiedAt: number; status: string }]> | undefined;
      if (prevModified) {
        for (const [filePath, mod] of prevModified) {
          if (!this.state.modifiedFiles.has(filePath)) {
            this.state.modifiedFiles.set(filePath, {
              filePath,
              modifiedAt: mod.modifiedAt,
              status: mod.status as "modified" | "created" | "failed",
            });
          }
        }
      }

      // Restore search results for context
      const prevSearch = parsed.searchResults as Array<[string, string[]]> | undefined;
      if (prevSearch) {
        for (const [query, files] of prevSearch) {
          if (!this.state.searchResults.has(query)) {
            this.state.searchResults.set(query, files);
          }
        }
      }

      const toolCallCount = (parsed.toolCalls as Array<unknown>)?.length ?? 0;

      this.save();
      return {
        hasPrevSession: true,
        toolCallCount,
        hasConventions: !!this.state.conventions,
      };
    } catch {
      return { hasPrevSession: false, toolCallCount: 0, hasConventions: !!this.state.conventions };
    }
  }

  /**
   * Search through tool call history, memory files, search results,
   * errors, and file modifications for a keyword.
   */
  searchMemory(query: string, limit: number = 20): Array<{ type: string; content: string; timestamp?: number }> {
    this.ensureInit();
    const results: Array<{ type: string; content: string; timestamp?: number }> = [];
    const q = query.toLowerCase();

    // 1. Search tool call history
    for (const call of this.state.toolCalls) {
      const paramStr = JSON.stringify(call.params);
      if (
        call.toolName.toLowerCase().includes(q) ||
        paramStr.toLowerCase().includes(q)
      ) {
        results.push({
          type: `tool:${call.toolName}`,
          content: `${call.toolName}(${JSON.stringify(call.params).substring(0, 200)})`,
          timestamp: call.timestamp,
        });
      }
    }

    // 2. Search search results history (query → file paths)
    for (const [queryStr, files] of this.state.searchResults) {
      if (queryStr.toLowerCase().includes(q) || files.some(f => f.toLowerCase().includes(q))) {
        results.push({
          type: "search",
          content: `Query: "${queryStr}" → ${files.slice(0, 5).join(", ")}${files.length > 5 ? ` (+${files.length - 5} more)` : ""}`,
        });
      }
    }

    // 3. Search modified files
    for (const [, mod] of this.state.modifiedFiles) {
      if (mod.filePath.toLowerCase().includes(q)) {
        results.push({
          type: `file:${mod.status}`,
          content: `${mod.status.toUpperCase()}: ${mod.filePath}`,
          timestamp: mod.modifiedAt,
        });
      }
    }

    // 4. Search failed files / error messages
    for (const [task, failures] of this.state.failedFiles) {
      for (const f of failures) {
        if (
          task.toLowerCase().includes(q) ||
          f.error.toLowerCase().includes(q)
        ) {
          results.push({
            type: `failure:${task}`,
            content: `[${f.resolved ? "RESOLVED" : "UNRESOLVED"}] ${task}: ${f.error.substring(0, 200)}`,
            timestamp: f.timestamp,
          });
        }
      }
    }

    // 5. Search dependency graph (files as keys)
    for (const [file, deps] of this.state.dependencyGraph) {
      if (file.toLowerCase().includes(q)) {
        results.push({
          type: "dependency",
          content: `${file} depends on: ${deps.join(", ")}`,
        });
      }
    }

    // 6. Search memory files (.kuma/memories/*.md)
    const memoriesDir = this.memoriesDir();
    if (fs.existsSync(memoriesDir)) {
      try {
        const files = fs.readdirSync(memoriesDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const filePath = path.join(memoriesDir, file);
          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(q)) {
                const topicName = file.replace(/\.md$/, "");
                results.push({
                  type: `memory:${topicName}`,
                  content: `[${topicName}] L${i + 1}: ${lines[i].trim().substring(0, 150)}`,
                });
                if (results.filter(r => r.type.startsWith("memory")).length >= 5) break;
              }
            }
          } catch {}
        }
      } catch {}
    }

    // Sort by timestamp (most recent first) where available
    results.sort((a, b) => {
      if (a.timestamp && b.timestamp) return b.timestamp - a.timestamp;
      if (a.timestamp) return -1;
      if (b.timestamp) return 1;
      return 0;
    });

    return results.slice(0, limit);
  }

  getConventions(): Record<string, unknown> | undefined {
    this.ensureInit();
    return this.state.conventions;
  }

  pruneMemory(): void {
    this.ensureInit();
    this.state.toolCalls = this.state.toolCalls.slice(-3);
    this.state.searchResults.clear();
    this.state.completedSteps = [];
    this.save();
  }

  getSummary(topic?: MemoryTopic): Record<string, unknown> {
    this.ensureInit();

    if (topic) {
      const content = this.getMemoryContent(topic);
      return { topic, content };
    }

    const unresolvedFailures: Array<{ task: string; error: string }> = [];
    const seen = new Set<string>();
    for (const [, failures] of this.state.failedFiles) {
      for (const f of failures) {
        if (f.resolved) continue;
        const error = f.error.substring(0, 200);
        if (!error.trim()) continue;
        const key = `${f.task}::${error}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unresolvedFailures.push({ task: f.task, error });
      }
    }

    const hasMemories = fs.existsSync(this.memoriesDir());
    let availableMemories: string[] = [];
    if (hasMemories) {
      try {
        availableMemories = fs.readdirSync(this.memoriesDir())
          .filter(f => f.endsWith(".md"))
          .map(f => f.replace(/\.md$/, ""));
      } catch {}
    }

    return {
      projectRoot: this.state.projectRoot,
      sessionDuration: Math.round((Date.now() - this.state.startTime) / 1000) + "s",
      currentGoal: this.state.currentGoal,
      completedSteps: this.state.completedSteps,
      modifiedFiles: Array.from(this.state.modifiedFiles.values()),
      unresolvedFailures,
      toolCallCount: this.state.toolCalls.length,
      recentSearches: Array.from(this.state.searchResults.keys()).slice(-5),
      hasConventions: !!this.state.conventions,
      ...(availableMemories.length > 0 ? { availableMemories } : {}),
      ...(availableMemories.length > 0 ? { hint: `Use get_session_memory({ topic: "<name>" }) to load a specific memory. Topics: ${availableMemories.join(", ")}` } : {}),
    };
  }

  getModifiedFiles(): FileModification[] {
    this.ensureInit();
    return Array.from(this.state.modifiedFiles.values());
  }

  getFailedFiles(): Array<{ task: string; failures: TestFailure[] }> {
    this.ensureInit();
    const result: Array<{ task: string; failures: TestFailure[] }> = [];
    for (const [task, failures] of this.state.failedFiles) {
      result.push({ task, failures });
    }
    return result;
  }

  getToolCallHistory(limit = 10): ToolCallRecord[] {
    this.ensureInit();
    return this.state.toolCalls.slice(-limit);
  }

  detectLoop(): { isLooping: boolean; toolName?: string; message?: string } {
    this.ensureInit();

    const recentCalls = this.state.toolCalls.slice(-10);
    if (recentCalls.length < 6) return { isLooping: false };

    // Check: same tool called >3 times
    const toolCounts = new Map<string, number>();
    for (const call of recentCalls) {
      toolCounts.set(call.toolName, (toolCounts.get(call.toolName) ?? 0) + 1);
    }

    for (const [toolName, count] of toolCounts) {
      if (count >= 4) {
        return {
          isLooping: true,
          toolName,
          message: `Detected potential loop: "${toolName}" called ${count} times in last ${recentCalls.length} tool calls. Consider a different approach.`,
        };
      }
    }

    return { isLooping: false };
  }

  private ensureInit(): void {
    if (!this.initialized) {
      this.init({
        projectRoot: process.cwd(),
        startTime: Date.now(),
      });
    }
  }
}

// Singleton
export const sessionMemory = new SessionMemory();

// Function for MCP tool
export function getSessionMemory(topic?: MemoryTopic): Record<string, unknown> {
  return sessionMemory.getSummary(topic);
}

export function searchSessionMemory(params: { query: string; limit?: number }): string {
  const { query, limit = 20 } = params;
  sessionMemory.recordToolCall("search_session_memory", { query, limit });
  const results = sessionMemory.searchMemory(query, limit);

  if (results.length === 0) {
    return `🔍 **Search Memory** — No results for "${query}".`;
  }

  const lines: string[] = [
    `🔍 **Search Memory** — ${results.length} results for "${query}"`,
    "",
  ];

  for (const r of results) {
    const icon = r.type.startsWith("tool:") ? "🛠️" :
                 r.type.startsWith("file:") ? (r.type.includes("created") ? "✨" : "📝") :
                 r.type.startsWith("failure") ? "❌" :
                 r.type.startsWith("memory") ? "🧠" :
                 r.type === "search" ? "🔎" :
                 r.type === "dependency" ? "🔗" :
                 "📄";
    const timeStr = r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : "";
    lines.push(`${icon} ${timeStr ? `[${timeStr}] ` : ""}${r.content}`);
  }

  lines.push("", `💡 Use get_session_memory({topic: "..."}) to load a specific memory topic.`);
  return lines.join("\n");
}

export function handleWriteMemory(params: { topic: MemoryTopic; content: string; mode?: "append" | "prepend" | "overwrite" }): string {
  const { topic, content, mode = "append" } = params;
  const existing = sessionMemory.getMemoryContent(topic);

  let finalContent = content;
  if (mode === "prepend") {
    finalContent = content + "\n\n" + existing;
  } else if (mode === "append") {
    finalContent = existing + "\n\n" + content;
  }

  sessionMemory.writeMemory(topic, finalContent);
  sessionMemory.recordToolCall("write_memory", { topic, mode });
  return `✅ Memory "${topic}" updated (mode: ${mode}).`;
}
