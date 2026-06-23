#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./manifest.js";
import { sessionMemory } from "./engine/sessionMemory.js";

// ============================================================
// MCP SERVER — ENTRY POINT
// ============================================================

const SERVER_NAME = "kuma";
const SERVER_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
).version;

async function main(): Promise<void> {
  // 1. Init session memory
  sessionMemory.init({
    projectRoot: process.cwd(),
    startTime: Date.now(),
  });

  // 2. Create MCP server
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      // Capabilities declaration
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  // 3. Register all tools
  registerAllTools(server);

  // 4. Connect transport
  const transport = new StdioServerTransport();
  console.error(`[${SERVER_NAME} v${SERVER_VERSION}] Starting MCP server...`);
  console.error(`[${SERVER_NAME}] Project root: ${process.cwd()}`);
  console.error(
    `[${SERVER_NAME}] Session started: ${new Date().toISOString()}`,
  );

  await server.connect(transport);

  console.error(
    `[${SERVER_NAME}] Server connected via stdio. Waiting for requests...`,
  );
}

main().catch((err) => {
  console.error(`[${SERVER_NAME}] Fatal error:`, err);
  process.exit(1);
});
