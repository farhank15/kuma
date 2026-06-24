import { getProjectRoot } from "../utils/pathValidator.js";
import { circuitBreaker } from "../utils/errorHandler.js";
import { sessionMemory } from "../engine/sessionMemory.js";
import { spawnShell, type ProcessResult } from "../utils/processRunner.js";

// ============================================================
// SAFE TERMINAL EXEC — Sandboxed terminal runner
// ============================================================

interface TerminalExecParams {
  task: "test" | "build" | "lint" | "typecheck" | "custom";
  customCommand?: string;
  timeout?: number;
}

// Map task → command
const TASK_COMMANDS: Record<string, string> = {
  test: "npm test",
  build: "npm run build",
  lint: "npm run lint",
  typecheck: "npx tsc --noEmit",
};

const DANGEROUS_PATTERNS = [
  "rm -rf",
  "rm -fr",
  "del /f",
  "rd /s",
  "rmdir /s",
  "git push",
  "git commit",
  "npm publish",
  "npx publish",
  "yarn publish",
  "pnpm publish",
  "> /dev/sda",
  "format",
  "mkfs",
  "dd if=",
  ":(){ :|:& };:",
  "curl ",
  "wget ",
];

export async function handleSafeTerminalExec(params: TerminalExecParams): Promise<string> {
  const { task, customCommand, timeout = 60 } = params;

  if (task === "custom" && !customCommand) {
    return "Error: Task 'custom' requires the 'customCommand' parameter.";
  }

  const command = task === "custom" ? customCommand! : TASK_COMMANDS[task];

  const cbResult = circuitBreaker.check("safe_terminal_exec", { task, command });
  if (!cbResult.allowed) {
    return `⚠️ Circuit breaker: ${cbResult.reason}\n\nFix the code first before running the task again.`;
  }

  const dangerousPattern = DANGEROUS_PATTERNS.find((p) => command.toLowerCase().includes(p.toLowerCase()));
  if (dangerousPattern) {
    return `🚫 BLOCKED: Command contains a dangerous pattern: "${dangerousPattern}".\nThis command is not permitted.`;
  }

  const projectRoot = getProjectRoot();

  try {
    sessionMemory.recordToolCall("execute_safe_test", { task, command });

    const result = await spawnShell(command, {
      cwd: projectRoot,
      timeoutSeconds: timeout,
    });

    const output = formatExecResult(result, command, task);

    if (result.exitCode !== 0) {
      sessionMemory.addFailedFile(task, result.stderr || result.stdout);
    }

    return output;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.toLowerCase().includes("timeout")) {
      return formatTimeoutResult(command, timeout);
    }
    return `Error running "${command}": ${errorMsg}`;
  }
}

function formatExecResult(result: ProcessResult, command: string, task: string): string {
  const status = result.exitCode === 0 ? "✅ PASS" : "❌ FAIL";
  const lines: string[] = [
    `💻 ${status} — Task: ${task}`,
    `$ ${command}`,
    `Exit code: ${result.exitCode}`,
    `Duration: ${result.timedOut ? "TIMEOUT" : "completed"}`,
    "",
  ];

  if (result.stdout.trim()) {
    lines.push("📤 STDOUT:", "```", result.stdout, "```", "");
  }

  if (result.stderr.trim()) {
    lines.push("📤 STDERR:", "```", result.stderr, "```", "");
  }

  if (result.exitCode !== 0) {
    lines.push(
      "💡 Recovery steps:",
      "  1. Read the error above — which file is failing?",
      "  2. Use smart_file_picker to open the failing file",
      "  3. Fix it with precise_diff_editor",
      "  4. Re-run the task to verify",
    );
  } else {
    lines.push("✅ All checks passed.");
  }

  return lines.join("\n");
}

function formatTimeoutResult(command: string, timeout: number): string {
  return [
    `⏰ TIMEOUT — "${command}" exceeded the ${timeout}s limit.`,
    "",
    "Possible causes:",
    "  1. Infinite loop in code",
    "  2. Test suite too slow (needs optimization)",
    "  3. Background process blocking",
    "",
    "Suggestions:",
    "  - Inspect the code for infinite loops",
    "  - Increase the timeout (max 180s)",
    "  - Run the command manually for diagnostics",
  ].join("\n");
}


