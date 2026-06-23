import {
  handleSafeTerminalExec,
} from "../src/tools/safeTerminalExec.js";

// ============================================================
// SAFE TERMINAL EXEC — Unit Tests
// ============================================================

describe("handleSafeTerminalExec — validation", () => {
  test("custom task requires customCommand", async () => {
    const result = await handleSafeTerminalExec({ task: "custom" } as any);
    expect(result).toContain("Error");
    expect(result).toContain("customCommand");
  });

  test("custom task with command returns output", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "echo 'hello world'" });
    expect(result).toContain("custom");
    expect(result).not.toContain("Error");
  });

  test("blocks dangerous patterns", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "rm -rf /" });
    expect(result).toContain("BLOCKED");
    expect(result).toContain("rm -rf");
  });

  test("blocks git push", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "git push origin main" });
    expect(result).toContain("BLOCKED");
    expect(result).toContain("git push");
  });

  test("allows safe commands", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "echo safe" });
    expect(result).not.toContain("BLOCKED");
  });

  test("custom task with complex command", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "ls -la" });
    expect(result).not.toContain("Error");
  });
});

describe("handleSafeTerminalExec — circuit breaker", () => {
  test("successful command is recorded and circuit breaker resets", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "echo ok" });
    expect(result).toContain("PASS");
  });

  test("timeout returns timeout message", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "sleep 10", timeout: 1 });
    expect(result).toContain("TIMEOUT");
  }, 5000);

  test("failing command returns FAIL status", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "node -e process.exit(1)" });
    expect(result).toContain("FAIL");
  });

  test("failing command includes recovery suggestions", async () => {
    const result = await handleSafeTerminalExec({ task: "custom", customCommand: "node -e process.exit(1)" });
    expect(result).toContain("Recovery");
  });
});

