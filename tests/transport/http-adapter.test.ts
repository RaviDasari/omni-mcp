import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { HttpAdapter } from "../../src/transport/http-adapter.js";
import type { HttpServerConfig } from "../../src/config/schema.js";

// Simple mock MCP HTTP server
function createMockMcpServer(): { server: Server; port: number; start: () => Promise<number> } {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const msg = JSON.parse(body);
      let result: unknown;

      if (msg.method === "initialize") {
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mock-http" },
        };
      } else if (msg.method === "notifications/initialized") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0" }));
        return;
      } else if (msg.method === "tools/list") {
        result = msg.params?.cursor === "page-2"
          ? { tools: [{ name: "status", description: "Check status" }] }
          : {
              tools: [{ name: "query", description: "Run a query" }],
              nextCursor: "page-2",
            };
      } else if (msg.method === "tools/call") {
        result = {
          content: [{ type: "text", text: `Executed ${msg.params.name}` }],
        };
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
    });
  });

  return {
    server,
    port: 0,
    start: () => new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        resolve(port);
      });
    }),
  };
}

describe("HttpAdapter", () => {
  let mockServer: Server;
  let port: number;

  beforeAll(async () => {
    const mock = createMockMcpServer();
    port = await mock.start();
    mockServer = mock.server;
  });

  afterAll(() => {
    mockServer.close();
  });

  function makeConfig(overrides: Partial<HttpServerConfig> = {}): HttpServerConfig {
    return {
      type: "http",
      url: `http://127.0.0.1:${port}`,
      timeoutMs: 5000,
      retries: 1,
      retryBackoffMs: 100,
      reconnectIntervalMs: 1000,
      ...overrides,
    };
  }

  it("connects to a mock HTTP MCP server", async () => {
    const adapter = new HttpAdapter("mock-http", makeConfig());

    await adapter.connect();
    expect(adapter.status).toBe("connected");

    await adapter.disconnect();
  });

  it("fetches tools from HTTP server", async () => {
    const adapter = new HttpAdapter("mock-http", makeConfig());
    await adapter.connect();

    const tools = await adapter.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("query");
    expect(tools[1].name).toBe("status");

    await adapter.disconnect();
  });

  it("calls tools on HTTP server", async () => {
    const adapter = new HttpAdapter("mock-http", makeConfig());
    await adapter.connect();

    const result = await adapter.callTool("query", { sql: "SELECT 1" });
    expect(result.content[0].text).toBe("Executed query");

    await adapter.disconnect();
  });

  it("returns empty tools when not connected", async () => {
    const adapter = new HttpAdapter("mock-http", makeConfig());
    // Don't connect
    const tools = await adapter.listTools();
    expect(tools).toEqual([]);
  });

  it("throws when calling tool on disconnected adapter", async () => {
    const adapter = new HttpAdapter("mock-http", makeConfig());
    await expect(adapter.callTool("test", {})).rejects.toThrow("unavailable");
  });

  it("handles connection failure gracefully", async () => {
    const adapter = new HttpAdapter("bad-server", makeConfig({
      url: "http://127.0.0.1:1", // Invalid port
      retries: 0,
      reconnectIntervalMs: 999999, // Don't reconnect during test
    }));

    await expect(adapter.connect()).rejects.toThrow();
    expect(adapter.status).toBe("error");

    await adapter.disconnect();
  });

  it("injects auth token in requests", async () => {
    const expectedToken = "my-secret-jwt";
    const expectedAuth = ["Bearer", expectedToken].join(" ");

    // Create a server that checks auth
    const authServer = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const auth = req.headers["authorization"];
        if (auth !== expectedAuth) {
          res.writeHead(401);
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -1, message: "Unauthorized" } }));
          return;
        }

        const msg = JSON.parse(body);
        let result: unknown = {};
        if (msg.method === "initialize") {
          result = { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "auth-test" } };
        } else if (msg.method === "tools/list") {
          result = { tools: [{ name: "secure_tool" }] };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
      });
    });

    const authPort = await new Promise<number>((resolve) => {
      authServer.listen(0, "127.0.0.1", () => {
        const addr = authServer.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      const adapter = new HttpAdapter(
        "auth-test",
        makeConfig({ url: `http://127.0.0.1:${authPort}` }),
        expectedToken,
      );

      await adapter.connect();
      expect(adapter.status).toBe("connected");

      const tools = await adapter.listTools();
      expect(tools[0].name).toBe("secure_tool");

      await adapter.disconnect();
    } finally {
      authServer.close();
    }
  });
});
