import { describe, it, expect, vi, beforeEach } from "vitest";
import { StdioAdapter } from "../../src/transport/stdio-adapter.js";
import type { StdioServerConfig } from "../../src/config/schema.js";

function makeStdioConfig(overrides: Partial<StdioServerConfig> = {}): StdioServerConfig {
  return {
    type: "stdio",
    command: "echo",
    args: ["hello"],
    maxRestarts: 3,
    restartBackoffMs: 100,
    callTimeoutMs: 5000,
    hangThreshold: 3,
    ...overrides,
  };
}

describe("StdioAdapter", () => {
  it("creates adapter with correct initial state", () => {
    const adapter = new StdioAdapter("test", makeStdioConfig());
    expect(adapter.name).toBe("test");
    expect(adapter.status).toBe("connecting");
    expect(adapter.restarts).toBe(0);
  });

  it("returns empty tools list when not connected", async () => {
    const adapter = new StdioAdapter("test", makeStdioConfig());
    const tools = await adapter.listTools();
    expect(tools).toEqual([]);
  });

  it("throws on callTool when not connected", async () => {
    const adapter = new StdioAdapter("test", makeStdioConfig());
    await expect(adapter.callTool("test", {})).rejects.toThrow("unavailable");
  });

  it("sets status to disabled after disconnect", async () => {
    const adapter = new StdioAdapter("test", makeStdioConfig());
    await adapter.disconnect();
    expect(adapter.status).toBe("disabled");
  });

  it("handles a mock MCP server via stdio", async () => {
    // Create a simple mock MCP server script
    const config = makeStdioConfig({
      command: "node",
      args: ["-e", `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mock' } }
            }) + '\\n');
          } else if (msg.method === 'notifications/initialized') {
            // no response needed
          } else if (msg.method === 'tools/list') {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: msg.params.cursor === 'page-2'
                ? { tools: [{ name: 'goodbye', description: 'Says goodbye' }] }
                : { tools: [{ name: 'hello', description: 'Says hello' }], nextCursor: 'page-2' }
            }) + '\\n');
          } else if (msg.method === 'tools/call') {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { content: [{ type: 'text', text: 'Hello ' + (msg.params.arguments.name || 'world') }] }
            }) + '\\n');
          }
        });
      `],
      callTimeoutMs: 10000,
    });

    const adapter = new StdioAdapter("mock-server", config);

    try {
      await adapter.connect();
      expect(adapter.status).toBe("connected");

      const tools = await adapter.listTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("hello");
      expect(tools[1].name).toBe("goodbye");

      const result = await adapter.callTool("hello", { name: "Alice" });
      expect(result.content[0].text).toBe("Hello Alice");
    } finally {
      await adapter.disconnect();
    }
  });

  it("handles process that exits (crash detection)", async () => {
    const config = makeStdioConfig({
      command: "node",
      args: ["-e", `
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const msg = JSON.parse(line);
          if (msg.method === 'initialize') {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'crash-test' } }
            }) + '\\n');
          } else if (msg.method === 'tools/list') {
            process.stdout.write(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { tools: [] }
            }) + '\\n');
          } else if (msg.method === 'tools/call') {
            // Crash on tool call
            process.exit(1);
          }
        });
      `],
      maxRestarts: 0, // Don't restart
      callTimeoutMs: 5000,
    });

    const adapter = new StdioAdapter("crash-test", config);
    await adapter.connect();
    expect(adapter.status).toBe("connected");

    // Call a tool that causes crash
    await expect(adapter.callTool("anything", {})).rejects.toThrow();

    // Wait for crash detection
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(adapter.status).toBe("error");

    await adapter.disconnect();
  });
});
