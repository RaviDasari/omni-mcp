import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../../src/gateway/gateway.js";
import type { ServerAdapter, ServerStatus, Tool, ToolResult } from "../../src/transport/types.js";
import type { OmniMcpConfig } from "../../src/config/schema.js";
import { writeConfig } from "../../src/config/write.js";
import { applyAdapterChanges } from "../../src/app.js";

class MockAdapter implements ServerAdapter {
  readonly name: string;
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  private _status: ServerStatus = "connected";
  private _restarts = 0;
  get status(): ServerStatus {
    return this._status;
  }
  get restarts(): number {
    return this._restarts;
  }
  constructor(name: string) {
    this.name = name;
  }
  async connect(): Promise<void> {
    this._status = "connected";
  }
  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "search_orgs",
        description: "Search organizations",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      { name: "upstream_error", inputSchema: { type: "object" } },
      { name: "throws", inputSchema: { type: "object" } },
    ];
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ name, args });
    if (name === "throws") throw new Error("upstream unavailable");
    if (name === "upstream_error") {
      return { content: [{ type: "text", text: "organization not found" }], isError: true };
    }
    return { content: [{ type: "text", text: JSON.stringify(args) }] };
  }
  async disconnect(): Promise<void> {
    this._status = "disabled";
  }
}

function makeConfig(): OmniMcpConfig {
  return {
    port: 6401,
    host: "127.0.0.1",
    defaultProfile: "default",
    shutdownGracePeriodMs: 1000,
    servers: {
      filesystem: {
        type: "stdio",
        command: "echo",
        args: [],
        maxRestarts: 3,
        restartBackoffMs: 1000,
        callTimeoutMs: 60000,
        hangThreshold: 3,
      },
    },
    profiles: {
      default: { allow: ["filesystem"] },
    },
    tokens: {
      default: { profile: "default", disabled: false },
    },
    security: { unknownTokenPolicy: "fallback-to-default" },
    trafficLog: { enabled: true, retentionDays: 7, maxBytes: 5242880 },
  };
}

describe("Management API", () => {
  let gateway: Gateway;
  const baseUrl = "http://127.0.0.1:6401";
  const dir = mkdtempSync(join(tmpdir(), "omni-mcp-api-"));
  const configPath = join(dir, "config.json");
  const adapters = new Map<string, ServerAdapter>();
  let current = makeConfig();

  beforeAll(async () => {
    writeConfig(configPath, current);
    adapters.set("filesystem", new MockAdapter("filesystem"));
    gateway = new Gateway({
      config: current,
      adapters,
      configPath,
      trafficLogDir: join(dir, "traffic"),
      version: "0.1.0",
      onSaveConfig: async (next) => {
        writeConfig(configPath, next);
        await applyAdapterChanges(adapters, current, next);
        current = next;
        gateway.updateConfig(next);
      },
      onReloadFromDisk: async () => {
        const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as OmniMcpConfig;
        current = parsed;
        gateway.updateConfig(parsed);
        return { warnings: [] };
      },
    });
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  it("GET /api/health includes version and configPath", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: string;
      configPath: string;
      servers: Record<string, { enabled: boolean }>;
    };
    expect(body.version).toBe("0.1.0");
    expect(body.configPath).toBe(configPath);
    expect(body.servers.filesystem.enabled).toBe(true);
  });

  it("GET /api/config returns servers", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: OmniMcpConfig };
    expect(body.config.servers.filesystem).toBeDefined();
  });

  it("PUT /api/profiles/:name adds a profile", async () => {
    const res = await fetch(`${baseUrl}/api/profiles/admin`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allow: ["*"] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: OmniMcpConfig };
    expect(body.config.profiles.admin.allow).toEqual(["*"]);
  });

  it("rejects invalid config", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { servers: {} } }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/ide-snippets returns cursor json", async () => {
    const res = await fetch(`${baseUrl}/api/ide-snippets`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { snippets: Array<{ id: string }> };
    expect(body.snippets.some((s) => s.id === "cursor")).toBe(true);
  });

  it("lists raw tools for a connected server", async () => {
    const res = await fetch(`${baseUrl}/api/servers/filesystem/tools`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      server: string;
      status: string;
      transport: string;
      tools: Tool[];
    };
    expect(body).toMatchObject({
      server: "filesystem",
      status: "connected",
      transport: "stdio",
    });
    expect(body.tools[0]).toMatchObject({
      name: "search_orgs",
      description: "Search organizations",
    });
  });

  it("calls a raw tool with arguments and returns its complete result", async () => {
    const res = await fetch(`${baseUrl}/api/servers/filesystem/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "search_orgs", arguments: { query: "acme" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      server: string;
      tool: string;
      durationMs: number;
      result: ToolResult;
    };
    expect(body.server).toBe("filesystem");
    expect(body.tool).toBe("search_orgs");
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.result.content[0]?.text).toBe('{"query":"acme"}');
    expect((adapters.get("filesystem") as MockAdapter).calls.at(-1)).toEqual({
      name: "search_orgs",
      args: { query: "acme" },
    });
  });

  it("preserves upstream MCP error results", async () => {
    const res = await fetch(`${baseUrl}/api/servers/filesystem/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "upstream_error", arguments: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: ToolResult };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toBe("organization not found");
  });

  it("validates direct tool calls and reports upstream failures", async () => {
    const malformed = await fetch(`${baseUrl}/api/servers/filesystem/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "search_orgs", arguments: [] }),
    });
    expect(malformed.status).toBe(400);

    const unknown = await fetch(`${baseUrl}/api/servers/filesystem/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "missing", arguments: {} }),
    });
    expect(unknown.status).toBe(404);

    const failed = await fetch(`${baseUrl}/api/servers/filesystem/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "throws", arguments: {} }),
    });
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toEqual({
      error: "Tool call failed: upstream unavailable",
    });
  });

  it("rejects direct tool APIs from non-loopback clients", async () => {
    let status = 0;
    let body = "";
    const req = {
      method: "GET",
      socket: { remoteAddress: "192.0.2.10" },
    };
    const res = {
      writeHead(code: number) {
        status = code;
      },
      end(value: string) {
        body = value;
      },
    };
    const api = gateway as unknown as {
      handleApi(
        request: typeof req,
        response: typeof res,
        url: URL,
      ): Promise<void>;
    };
    await api.handleApi(req, res, new URL(`${baseUrl}/api/servers/filesystem/tools`));
    expect(status).toBe(403);
    expect(JSON.parse(body)).toEqual({
      error: "This endpoint is only available from localhost",
    });
  });

  it("records tool-call metadata and serves list and grouped APIs", async () => {
    const call = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer default",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "filesystem__read_file",
          arguments: { secret: "must-not-be-logged" },
        },
      }),
    });
    expect(call.status).toBe(200);

    const list = await fetch(`${baseUrl}/api/traffic-logs?token=default&server=filesystem`);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      events: Array<Record<string, unknown>>;
      total: number;
    };
    expect(listBody.total).toBe(1);
    expect(listBody.events[0]).toMatchObject({
      token: "default",
      profile: "default",
      server: "filesystem",
      tool: "read_file",
      outcome: "ok",
    });
    expect(JSON.stringify(listBody)).not.toContain("must-not-be-logged");

    const summary = await fetch(`${baseUrl}/api/traffic-logs/summary?groupBy=tool`);
    expect(summary.status).toBe(200);
    const summaryBody = (await summary.json()) as {
      totalEvents: number;
      groups: Array<{ key: string; count: number }>;
    };
    expect(summaryBody.totalEvents).toBe(1);
    expect(summaryBody.groups[0]).toMatchObject({
      key: "filesystem__read_file",
      count: 1,
    });
  });

  it("records an empty token when Authorization is missing", async () => {
    const call = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "filesystem__read_file", arguments: {} },
      }),
    });
    expect(call.status).toBe(200);

    const list = await fetch(`${baseUrl}/api/traffic-logs`);
    const body = (await list.json()) as {
      events: Array<{ token: string }>;
    };
    expect(body.events.some((entry) => entry.token === "")).toBe(true);
  });

  it("validates traffic log query parameters and clears records", async () => {
    const invalid = await fetch(`${baseUrl}/api/traffic-logs?limit=201`);
    expect(invalid.status).toBe(400);

    const cleared = await fetch(`${baseUrl}/api/traffic-logs`, { method: "DELETE" });
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toEqual({ ok: true, deleted: true });

    const list = await fetch(`${baseUrl}/api/traffic-logs`);
    const body = (await list.json()) as { total: number };
    expect(body.total).toBe(0);
  });

  it("PUT /api/servers/:name/enabled disables a server globally", async () => {
    const res = await fetch(`${baseUrl}/api/servers/filesystem/enabled`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      config: OmniMcpConfig;
      health: { servers: Record<string, { enabled: boolean; status: string }> };
    };
    expect(body.config.servers.filesystem.enabled).toBe(false);
    expect(body.health.servers.filesystem).toMatchObject({
      enabled: false,
      status: "disabled",
    });
    expect(adapters.has("filesystem")).toBe(false);

    const persisted = JSON.parse(readFileSync(configPath, "utf-8")) as OmniMcpConfig;
    expect(persisted.servers.filesystem.enabled).toBe(false);

    const tools = await fetch(`${baseUrl}/api/servers/filesystem/tools`);
    expect(tools.status).toBe(404);
    await expect(tools.json()).resolves.toEqual({
      error: 'Server "filesystem" is disabled',
    });
  });
});
