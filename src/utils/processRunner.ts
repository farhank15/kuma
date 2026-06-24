import { spawn, type ChildProcess } from "node:child_process";

// ============================================================
// PROCESS RUNNER — Shared spawn utility with timeout & safety
// Extracted from safeTerminalExec.ts & staticAnalysis.ts
// ============================================================

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface SpawnOptions {
  cwd: string;
  timeoutSeconds?: number;
  useShell?: boolean;
  maxStdout?: number;
  maxStderr?: number;
}

const DEFAULT_MAX_STDOUT = 5000;
const DEFAULT_MAX_STDERR = 2000;
const DEFAULT_TIMEOUT = 60;

/**
 * Spawn a command with timeout, collect stdout/stderr, kill on timeout.
 * Abstracts away the common spawn + timeout + kill pattern used across tools.
 */
export function spawnProcess(
  command: string,
  options: SpawnOptions,
): Promise<ProcessResult> {
  const {
    cwd,
    timeoutSeconds = DEFAULT_TIMEOUT,
    useShell = false,
    maxStdout = DEFAULT_MAX_STDOUT,
    maxStderr = DEFAULT_MAX_STDERR,
  } = options;

  return new Promise<ProcessResult>((resolve) => {
    const parts = command.split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);

    const proc: ChildProcess = spawn(cmd, args, {
      cwd,
      shell: useShell,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    // Timeout handler
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");

      // Kill process tree on Windows
      if (process.platform === "win32") {
        try {
          spawn("taskkill", ["/pid", String(proc.pid), "/f", "/t"], {
            stdio: "ignore",
          });
        } catch {
          // Ignore kill errors
        }
      }
    }, timeoutSeconds * 1000);

    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      resolve({
        stdout: truncateOutput(stdout, maxStdout),
        stderr: truncateOutput(stderr, maxStderr),
        exitCode: code ?? -1,
        timedOut,
      });
    });

    proc.on("error", () => {
      clearTimeout(timeoutId);
      resolve({
        stdout,
        stderr: `Failed to spawn process: ${cmd}`,
        exitCode: -1,
        timedOut: false,
      });
    });
  });
}

/**
 * Spawn with shell enabled (for npm/node scripts on all platforms).
 */
export function spawnShell(
  command: string,
  options: SpawnOptions,
): Promise<ProcessResult> {
  return spawnProcess(command, { ...options, useShell: true });
}

function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  return (
    output.slice(0, maxChars) +
    `\n\n[...truncated, ${output.length - maxChars} more characters]`
  );
}
