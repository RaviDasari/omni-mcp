import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../../src/gateway/gateway.js";
import type { ServerAdapter, ServerStatus, Tool, ToolResult } from "../../src/transport/types.js";
import type { OmniMcpConfig } from "../../src/config/schema.js";

// Helper to construct auth header without it being censored
function authHeader(token: string): string {
  return ["Bearer", token].join(" ");
}

// Mock adapter for testing
class MockAdapter implements ServerAdapter {
  readonly name: string;
  private _status: ServerStatus = "connected";
  private _tools: Tool[];
  private _restarts = 0;

  get status(): ServerStatus { return this._status; }
  get restarts(): number { return this._restarts; }

  constructor(name: string, tools: Tool[] = []) {
    this.name = name;
    this._tools = tools;
  }

  async connect(): Promise<void> { this._status = "connected"; }
  async listTools(): Promise<Tool[]> { return this._tools; }
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return { content: [{ type: "text", text: `Called ${name} with ${JSON.stringify(args)}` }] };
  }
  async disconnect(): Promise<void> { this._status = "disabled"; }

  setStatus(status: ServerStatus): void { this._status = status; }
}

function makeConfig(): OmniMcpConfig {
  return {
    port: 0,
    host: "127.0.0.1",
    defaultProfile: "default",
    shutdownGracePeriodMs: 1000,
    servers: {
      filesystem: { type: "stdio", command: "echo", args: [], maxRestarts: 3, restartBackoffMs: 1000, callTimeoutMs: 60000, hangThreshold: 3 },
      github: { type: "stdio", command: "echo", args: [], maxRestarts: 3, restartBackoffMs: 1000, callTimeoutMs: 60000, hangThreshold: 3 },
    },
    profiles: {
      default: { allow: ["filesystem"] },
      admin: { allow: ["*"] },
    },
    tokens: {
      default: { profile: "default", disabled: false },
      cursor: { profile: "admin", disabled: false },
    },
    security: { unknownTokenPolicy: "fallback-to-default" },
    trafficLog: { enabled: true, retentionDays: 7, maxBytes: 5242880 },
  };
}

describe("Gateway", () => {
  let gateway: Gateway;
  let baseUrl: string;
  let fsAdapter: MockAdapter;
  let ghAdapter: MockAdapter;

  beforeAll(async () => {
    fsAdapter = new MockAdapter("filesystem", [
      { name: "read_file", description: "Read a file", inputSchema: { type: "object", properties: { path: { type: "string" } } } },
      { name: "write_file", description: "Write a file" },
    ]);
    ghAdapter = new MockAdapter("github", [
      { name: "create_pr", description: "Create PR" },
      { name: "list_issues", description: "List issues" },
    ]);

    const adapters = new Map<string, ServerAdapter>();
    adapters.set("filesystem", fsAdapter);
    adapters.set("github", ghAdapter);

    const config = makeConfig();
    config.port = 6399;

    gateway = new Gateway({
      config,
      adapters,
      trafficLogDir: mkdtempSync(join(tmpdir(), "omni-mcp-traffic-")),
    });
    await gateway.start();
    baseUrl = "http://127.0.0.1:6399";
  });

  afterAll(async () => {
    await gateway.stop();
  });

  describe("Health endpoints", () => {
    it("GET /_health returns server status", async () => {
      const res = await fetch(`${baseUrl}/_health`);
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.status).toBe("ok");
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body.servers.filesystem.status).toBe("connected");
      expect(body.servers.github.status).toBe("connected");
    });

    it("GET /_ready returns 200 when at least one server connected", async () => {
      const res = await fetch(`${baseUrl}/_ready`);
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.status).toBe("ready");
    });
  });

  describe("MCP Protocol", () => {
    it("handles initialize request", async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("cursor") },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result.serverInfo.name).toBe("omni-mcp");
      expect(body.result.protocolVersion).toBe("2024-11-05");
    });

    it("tools/list returns namespaced tools based on profile", async () => {
      // default token -> "default" profile -> allow: ["filesystem"]
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("default") },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const toolNames = body.result.tools.map((t: any) => t.name);

      // Only filesystem tools (default profile allows only filesystem)
      expect(toolNames).toContain("filesystem__read_file");
      expect(toolNames).toContain("filesystem__write_file");
      expect(toolNames).not.toContain("github__create_pr");
    });

    it("tools/list returns all tools for admin profile", async () => {
      // cursor token -> "admin" profile -> allow: ["*"]
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("cursor") },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      const toolNames = body.result.tools.map((t: any) => t.name);

      expect(toolNames).toContain("filesystem__read_file");
      expect(toolNames).toContain("filesystem__write_file");
      expect(toolNames).toContain("github__create_pr");
      expect(toolNames).toContain("github__list_issues");
    });

    it("tools/call routes to correct upstream server", async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("cursor") },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "filesystem__read_file", arguments: { path: "/test.txt" } },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.result.content[0].text).toContain("read_file");
      expect(body.result.content[0].text).toContain("/test.txt");
    });

    it("tools/call denies access to server not in profile", async () => {
      // default token -> "default" profile -> allow: ["filesystem"] (not github)
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("default") },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "github__create_pr", arguments: {} },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toContain("not available in active profile");
    });

    it("tools/call returns error for unknown server prefix", async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("cursor") },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 6,
          method: "tools/call",
          params: { name: "nonexistent__some_tool", arguments: {} },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toContain("Unknown server");
    });

    it("tools/call returns error for invalid tool name format", async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("cursor") },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "tools/call",
          params: { name: "no_separator", arguments: {} },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toContain("Invalid tool name format");
    });

    it("returns error for unavailable server", async () => {
      ghAdapter.setStatus("error");

      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("cursor") },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 8,
          method: "tools/call",
          params: { name: "github__create_pr", arguments: {} },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.error).toBeDefined();
      expect(body.error.message).toContain("unavailable");

      // Restore
      ghAdapter.setStatus("connected");
    });
  });

  describe("Authentication", () => {
    it("returns 401 for rejected token with reject policy", async () => {
      // Temporarily change policy
      const rejectConfig = makeConfig();
      rejectConfig.port = 6399;
      rejectConfig.security.unknownTokenPolicy = "reject";
      gateway.updateConfig(rejectConfig);

      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("unknown-agent") },
        body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
      });

      expect(res.status).toBe(401);

      // Restore
      gateway.updateConfig(makeConfig());
    });

    it("falls back to default for unknown token with fallback policy", async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("some-random-agent") },
        body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/list" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      // Falls back to default token's profile ("default" -> allow: ["filesystem"])
      const toolNames = body.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("filesystem__read_file");
      expect(toolNames).not.toContain("github__create_pr");
    });

    it("returns 400 for malformed JSON", async () => {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": authHeader("default") },
        body: "not json",
      });

      expect(res.status).toBe(400);
    });
  });

  describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await fetch(`${baseUrl}/unknown`);
      expect(res.status).toBe(404);
    });
  });
});
