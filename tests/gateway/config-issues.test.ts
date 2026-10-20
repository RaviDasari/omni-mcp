import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../../src/gateway/gateway.js";
import { applyAdapterChanges, createAdapters } from "../../src/app.js";
import type { ServerAdapter, ServerStatus, Tool, ToolResult } from "../../src/transport/types.js";
import type { OmniMcpConfig } from "../../src/config/schema.js";

const ROWS = JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `user${i}` })));

class MockAdapter implements ServerAdapter {
  private _status: ServerStatus = "connected";
  readonly restarts = 0;
  get status(): ServerStatus {
    return this._status;
  }
  constructor(readonly name: string) {}
  async connect(): Promise<void> {
    this._status = "connected";
  }
  async listTools(): Promise<Tool[]> {
    return [{ name: "list_users", inputSchema: { type: "object" } }];
  }
  async callTool(): Promise<ToolResult> {
    return { content: [{ type: "text", text: ROWS }] };
  }
  async disconnect(): Promise<void> {
    this._status = "disabled";
  }
}

const stdio = {
  type: "stdio" as const,
  command: "echo",
  args: [],
  maxRestarts: 3,
  restartBackoffMs: 1000,
  callTimeoutMs: 60000,
  hangThreshold: 3,
};

function makeConfig(toon = false): OmniMcpConfig {
  return {
    port: 6402,
    host: "127.0.0.1",
    defaultProfile: "default",
    shutdownGracePeriodMs: 1000,
    servers: {
      api: { ...stdio, cli: { enabled: true }, toon: { enabled: toon } },
      jira: { ...stdio, env: { TOKEN: "$JIRA_TOKEN" } },
    },
    profiles: { default: { allow: ["*"] } },
    tokens: { default: { profile: "default", disabled: false } },
    security: { unknownTokenPolicy: "fallback-to-default" },
    trafficLog: { enabled: false, retentionDays: 7, maxBytes: 5242880 },
    secretBackend: { backend: "file", keychainService: "omni-mcp" },
  };
}

const ISSUES = { jira: ['servers.jira.env.TOKEN references "JIRA_TOKEN", which is not set'] };

describe("blocked servers", () => {
  it("createAdapters skips servers with unresolved references", async () => {
    const adapters = await createAdapters(makeConfig(), ISSUES);
    expect([...adapters.keys()]).toEqual(["api"]);
  });

  it("applyAdapterChanges disconnects a newly blocked server and skips it", async () => {
    const config = makeConfig();
    const adapters = new Map<string, ServerAdapter>([
      ["api", new MockAdapter("api")],
      ["jira", new MockAdapter("jira")],
    ]);
    const jira = adapters.get("jira")!;

    await applyAdapterChanges(adapters, config, config, ISSUES, {});

    expect(jira.status).toBe("disabled");
    expect(adapters.has("jira")).toBe(false);
    expect(adapters.has("api")).toBe(true);
  });
});

describe("Gateway config issues and TOON", () => {
  const baseUrl = "http://127.0.0.1:6402";
  const dir = mkdtempSync(join(tmpdir(), "omni-mcp-issues-"));
  let gateway: Gateway;

  beforeAll(async () => {
    gateway = new Gateway({
      config: makeConfig(),
      adapters: new Map<string, ServerAdapter>([["api", new MockAdapter("api")]]),
      trafficLogDir: join(dir, "traffic"),
      serverIssues: ISSUES,
      globalIssues: ["Secret backend \"keychain\" is unavailable: locked"],
      version: "0.1.0",
    });
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  it("reports blocked servers and global issues in /api/health", async () => {
    const body = await (await fetch(`${baseUrl}/api/health`)).json() as any;
    expect(body.servers.jira.status).toBe("config-error");
    expect(body.servers.jira.issues).toEqual(ISSUES.jira);
    expect(body.servers.api.status).toBe("connected");
    expect(body.issues).toHaveLength(1);
  });

  it("explains why a blocked server cannot be called", async () => {
    const res = await fetch(`${baseUrl}/api/servers/jira/tools`);
    const body = await res.json() as any;
    expect(res.status).toBe(409);
    expect(body.error).toContain("was not started");
    expect(body.error).toContain("JIRA_TOKEN");
  });

  it("clears issues when updateConfig is called without them", async () => {
    gateway.updateConfig(makeConfig());
    const body = await (await fetch(`${baseUrl}/api/health`)).json() as any;
    expect(body.servers.jira.status).not.toBe("config-error");
    expect(body.issues).toBeUndefined();
    gateway.updateConfig(makeConfig(), makeConfig(), { serverIssues: ISSUES });
  });

  const callPlayground = async () => {
    const res = await fetch(`${baseUrl}/api/servers/api/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "list_users", arguments: {} }),
    });
    return (await res.json() as any).result.content[0].text as string;
  };
  const callCli = async () => {
    const res = await fetch(`${baseUrl}/api/cli/servers/api/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "list_users", arguments: {} }),
    });
    return (await res.json() as any).result.content[0].text as string;
  };

  it("returns TOON from the Playground and CLI routes only when the server enables it", async () => {
    expect(await callPlayground()).toBe(ROWS);
    expect(await callCli()).toBe(ROWS);

    gateway.updateConfig(makeConfig(true), makeConfig(true), { serverIssues: ISSUES });
    const playground = await callPlayground();
    const cli = await callCli();
    expect(playground).not.toBe(ROWS);
    expect(playground.length).toBeLessThan(ROWS.length);
    expect(cli).toBe(playground);
  });
});
