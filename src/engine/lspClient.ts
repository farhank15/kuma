import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { getProjectRoot } from "../utils/pathValidator.js";

// ============================================================
// LSP CLIENT — Spawns & manages typescript-language-server
// ============================================================

interface LSPLocation {
  uri: string;
  filePath: string;
  line: number;      // 0-indexed
  character: number; // 0-indexed
}

interface LSPReference {
  filePath: string;
  line: number;
  character: number;
  lineContent: string;
}

interface LSPHoverInfo {
  contents: string;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface LSPRenameResult {
  changes: Array<{
    filePath: string;
    edits: Array<{ line: number; character: number; endLine: number; endCharacter: number; newText: string }>;
  }>;
  success: boolean;
  error?: string;
}

class LSPClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: unknown) => void }>();
  private buffer: Buffer = Buffer.alloc(0);
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private openDocuments = new Set<string>();
  private _isAvailable = true;

  /** Check whether LSP is available (binary installed) */
  isAvailable(): boolean {
    return this._isAvailable;
  }

  async ensureInitialized(): Promise<void> {
    if (this._isAvailable !== undefined && !this._isAvailable) return;
    if (this.initialized && this.process) return;

    // If previous init failed, reset so we can retry
    if (this.initPromise) {
      try {
        await this.initPromise;
        return; // succeeded
      } catch {
        // Previous init failed — reset and retry
        this.initPromise = null;
      }
    }

    this.initPromise = this.initialize();
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const root = getProjectRoot();

    // Resolve typescript-language-server binary (local or global)
    const lspBinary = this.resolveLspBinary(root);
    if (!lspBinary) {
      this._isAvailable = false;
      this.initialized = false;
      this.initPromise = null;
      console.error(`[LSP] typescript-language-server not found. LSP features will fallback to regex.`);
      return;
    }

    // Check if tsconfig.json exists, if not warn but proceed
    const tsconfigPath = path.join(root, "tsconfig.json");
    if (!fs.existsSync(tsconfigPath)) {
      console.error(`[LSP] Warning: tsconfig.json not found at "${root}". Running in implicit project mode.`);
    }

    // Spawn typescript-language-server
    this.process = spawn(lspBinary, ["--stdio", "--log-level=4"], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Handle stdout (LSP responses)
    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.processBuffer();
    });

    // Forward stderr to console.error (logging)
    this.process.stderr?.on("data", (data: Buffer) => {
      console.error(`[LSP] ${data.toString().trim()}`);
    });

    // Handle process exit
    this.process.on("exit", (code) => {
      console.error(`[LSP] Process exited with code ${code}`);
      this.initialized = false;
      this.process = null;
      this.initPromise = null;
      this.openDocuments.clear();
      this.buffer = Buffer.alloc(0);

      // Reject all pending requests
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`LSP server exited (code ${code})`));
      }
      this.pending.clear();
    });

    // Handle spawn errors (e.g., binary not found)
    this.process.on("error", (err) => {
      console.error(`[LSP] Process error: ${err.message}. LSP features will fallback to regex.`);
      this._isAvailable = false;
      this.process = null;
      this.initialized = false;
      this.initPromise = null;
      this.openDocuments.clear();

      // Reject all pending requests to prevent hangs
      for (const [, pending] of this.pending) {
        pending.reject(new Error(`LSP server error: ${err.message}`));
      }
      this.pending.clear();
    });

    // Send initialize request
    const rootUri = this.toUri(root);
    const initResult = await this.sendRequestRaw("initialize", {
      processId: null,
      rootPath: root,
      rootUri,
      capabilities: {
        textDocument: {
          references: {},
          definition: {},
          rename: { prepareSupport: true },
          hover: {
            contentFormat: ["markdown", "plaintext"]
          },
        },
      },
    }) as { capabilities: Record<string, unknown> };

    console.error(`[LSP] Initialized. Server capabilities: ${Object.keys(initResult.capabilities ?? {}).length} items`);

    // Send initialized notification
    this.sendNotification("initialized", {});

    this.initialized = true;
  }

  /** Resolve the typescript-language-server binary from local or global install */
  private resolveLspBinary(projectRoot: string): string | null {
    const candidates = [
      path.join(projectRoot, "node_modules", ".bin", "typescript-language-server"),
      path.join(projectRoot, "..", "node_modules", ".bin", "typescript-language-server"),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Try to find on PATH
    try {
      const envPath = process.env.PATH ?? "";
      for (const dir of envPath.split(path.delimiter)) {
        const binPath = path.join(dir, "typescript-language-server");
        if (fs.existsSync(binPath)) {
          return binPath;
        }
      }
    } catch {
      // ignore PATH resolution errors
    }

    // Try npx fallback — auto-install typescript-language-server
    // Most projects don't have it as a direct dependency but npx can fetch it
    console.error(`[LSP] typescript-language-server not found locally. Trying npx fallback.`);
    return "npx --yes typescript-language-server";
  }

  private toUri(filePath: string): string {
    return `file://${filePath}`;
  }

  private fromUri(uri: string): string {
    return uri.replace(/^file:\/\//, "");
  }

  /** Open a document so the LSP server knows about it */
  async openDocument(filePath: string): Promise<void> {
    await this.ensureInitialized();

    // Guard against concurrent openDocument for same file
    if (this.openDocuments.has(filePath)) return;
    this.openDocuments.add(filePath);

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      content = "";
    }

    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: this.toUri(filePath),
        languageId: "typescript",
        version: 1,
        text: content,
      },
    });
  }

  // ============================================================
  // LSP METHODS
  // ============================================================

  /** Find all references to a symbol at a position */
  async findReferences(filePath: string, line: number, character: number): Promise<LSPReference[]> {
    await this.ensureInitialized();
    await this.openDocument(filePath);

    const result = await this.sendRequestRaw("textDocument/references", {
      textDocument: { uri: this.toUri(filePath) },
      position: { line, character },
      context: { includeDeclaration: true },
    }) as Array<{ uri: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }>;

    if (!result || !Array.isArray(result)) return [];

    return result.map((ref) => ({
      filePath: this.fromUri(ref.uri),
      line: ref.range.start.line,
      character: ref.range.start.character,
      lineContent: "",
    }));
  }

  /** Get the definition location of a symbol */
  async goToDefinition(filePath: string, line: number, character: number): Promise<LSPLocation | null> {
    await this.ensureInitialized();
    await this.openDocument(filePath);

    const result = await this.sendRequestRaw("textDocument/definition", {
      textDocument: { uri: this.toUri(filePath) },
      position: { line, character },
    }) as Array<{ uri: string; range: { start: { line: number; character: number } } }> | { uri: string; range: { start: { line: number; character: number } } } | null;

    if (!result) return null;

    // Handle both array and single response
    const loc = Array.isArray(result) ? result[0] : result;
    if (!loc) return null;

    return {
      uri: loc.uri,
      filePath: this.fromUri(loc.uri),
      line: loc.range.start.line,
      character: loc.range.start.character,
    };
  }

  /** Rename a symbol across all files */
  async renameSymbol(filePath: string, line: number, character: number, newName: string): Promise<LSPRenameResult> {
    await this.ensureInitialized();
    await this.openDocument(filePath);

    try {
      // First, prepare rename (validate it's a valid symbol to rename)
      await this.sendRequestRaw("textDocument/prepareRename", {
        textDocument: { uri: this.toUri(filePath) },
        position: { line, character },
      });

      // Send rename request
      const result = await this.sendRequestRaw("textDocument/rename", {
        textDocument: { uri: this.toUri(filePath) },
        position: { line, character },
        newName,
      }) as { changes?: Record<string, Array<{ range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string }>>; documentChanges?: Array<unknown> } | null;

      if (!result) {
        return { changes: [], success: false, error: "No rename result returned" };
      }

      // Convert workspace edit to our format
      const changes: LSPRenameResult["changes"] = [];
      const rawChanges = result.changes ?? {};

      for (const [uri, edits] of Object.entries(rawChanges)) {
        changes.push({
          filePath: this.fromUri(uri),
          edits: edits.map((edit) => ({
            line: edit.range.start.line,
            character: edit.range.start.character,
            endLine: edit.range.end.line,
            endCharacter: edit.range.end.character,
            newText: edit.newText,
          })),
        });
      }

      return { changes, success: true };
    } catch (err) {
      return {
        changes: [],
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Get type information at a position */
  async getTypeInfo(filePath: string, line: number, character: number): Promise<LSPHoverInfo | null> {
    await this.ensureInitialized();
    await this.openDocument(filePath);

    const result = await this.sendRequestRaw("textDocument/hover", {
      textDocument: { uri: this.toUri(filePath) },
      position: { line, character },
    }) as { contents: Array<{ language: string; value: string }> | { kind: string; value: string } | string; range?: { start: { line: number; character: number }; end: { line: number; character: number } } } | null;

    if (!result) return null;

    // Parse hover contents (can be MarkupContent, MarkedString, or string)
    let contents = "";
    if (typeof result.contents === "string") {
      contents = result.contents;
    } else if (Array.isArray(result.contents)) {
      contents = result.contents.map((c) => c.value ?? c).join("\n---\n");
    } else if (result.contents && typeof result.contents === "object" && "value" in result.contents) {
      contents = (result.contents as { value: string }).value;
    } else {
      contents = JSON.stringify(result.contents);
    }

    return {
      contents,
      range: result.range,
    };
  }

  /** Clean shutdown */
  async shutdown(): Promise<void> {
    if (!this.process) return;

    try {
      await this.sendRequestRaw("shutdown", {});
      this.sendNotification("exit", {});
    } catch {
      // Ignore shutdown errors
    }

    this.process.kill();
    this.process = null;
    this.initialized = false;
    this.initPromise = null;
    this.openDocuments.clear();
  }

  // ============================================================
  // JSON-RPC LOW-LEVEL
  // ============================================================

  private sendRequestRaw(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });

      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      if (!this.process?.stdin?.writable) {
        this.pending.delete(id);
        reject(new Error("LSP server not running"));
        return;
      }

      const header = `Content-Length: ${Buffer.byteLength(message, "utf-8")}\r\n\r\n`;
      this.process.stdin.write(header + message);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });

    if (!this.process?.stdin?.writable) {
      console.error(`[LSP] Cannot send notification ${method}: server not running`);
      return;
    }

    const header = `Content-Length: ${Buffer.byteLength(message, "utf-8")}\r\n\r\n`;
    this.process.stdin.write(header + message);
  }

  /** Parse LSP buffer. Messages are in format: Content-Length: N\r\n\r\n<JSON> */
  private processBuffer(): void {
    const headerEnd = "\r\n\r\n";

    while (true) {
      const headerIdx = this.buffer.indexOf(headerEnd);
      if (headerIdx === -1) break;

      // Parse Content-Length header
      const header = this.buffer.subarray(0, headerIdx).toString("utf-8");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(headerIdx + 4);
        continue;
      }

      const contentLength = parseInt(lengthMatch[1], 10);
      const messageStart = headerIdx + 4;
      const messageEnd = messageStart + contentLength;

      if (this.buffer.length < messageEnd) break; // Wait for more data

      const content = this.buffer.subarray(messageStart, messageEnd).toString("utf-8");
      this.buffer = this.buffer.subarray(messageEnd);

      try {
        const msg = JSON.parse(content);
        this.handleMessage(msg as Record<string, unknown>);
      } catch (err) {
        console.error(`[LSP] Failed to parse message: ${err}`);
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    // Handle responses (id present)
    if (msg.id && typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (!pending) {
        console.error(`[LSP] No pending request for id ${msg.id}`);
        return;
      }
      this.pending.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(JSON.stringify(msg.error)));
      } else {
        pending.resolve(msg.result);
      }
    }

    // Handle notifications (no id)
    if (!msg.id) {
      if (msg.method === "textDocument/publishDiagnostics") {
        // We could integrate diagnostics later
      }
    }
  }
}

// Singleton
export const lspClient = new LSPClient();

export type { LSPLocation, LSPReference, LSPHoverInfo, LSPRenameResult };
