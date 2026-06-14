import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { OmniMcpConfig } from "../config/index.js";
import { resolveToken, isServerAllowed, getAllowedServers } from "../auth/index.js";
import type { ServerAdapter, Tool, ToolResult } from "../transport/index.js";
import { Logger } from "../logger.js";

const TOOL_SEPARATOR = "__";

export interface GatewayOptions {
  config: OmniMcpConfig;
  adapters: Map<string, ServerAdapter>;
}

export class Gateway {
  private config: OmniMcpConfig;
  private adapters: Map<string, ServerAdapter>;
  private server: Server | null = null;
  private logger = new Logger("omni-mcp");
  private startTime = 0;

  constructor(options: GatewayOptions) {
    this.config = options.config;
    this.adapters = options.adapters;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        this.logger.error(`Unhandled error: ${err instanceof Error ? err.message : "Unknown"}`);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        this.logger.info(`Listening on http://${this.config.host}:${this.config.port}`);
        resolve();
      });
      this.server!.on("error", reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        resolve();
      });

      // Force close after grace period
      setTimeout(() => {
        this.server?.closeAllConnections();
        resolve();
      }, this.config.shutdownGracePeriodMs);
    });
  }

  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  updateConfig(config: OmniMcpConfig): void {
    this.config = config;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Health check endpoints
    if (url.pathname === "/_health" && req.method === "GET") {
      return this.handleHealth(res);
    }
    if (url.pathname === "/_ready" && req.method === "GET") {
      return this.handleReady(res);
    }

    // MCP endpoint
    if (url.pathname === "/mcp" && req.method === "POST") {
      return this.handleMcp(req, res);
    }

    // SSE endpoint for server→client (placeholder)
    if (url.pathname === "/mcp" && req.method === "GET") {
      return this.handleSse(req, res);
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private handleHealth(res: ServerResponse): void {
    const servers: Record<string, unknown> = {};
    for (const [name, adapter] of this.adapters) {
      servers[name] = {
        status: adapter.status,
        transport: name in (this.config.servers ?? {})
          ? this.config.servers[name].type
          : "unknown",
        restarts: adapter.restarts,
      };
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        uptime: this.getUptime(),
        servers,
      }),
    );
  }

  private handleReady(res: ServerResponse): void {
    const hasConnected = Array.from(this.adapters.values()).some(
      (a) => a.status === "connected",
    );

    if (hasConnected) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ready" }));
    } else {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "not_ready" }));
    }
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Authenticate
    const authHeader = req.headers["authorization"] as string | undefined;
    const tokenResult = resolveToken(authHeader, this.config);

    if (tokenResult.status === "rejected") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: "Unauthorized",
            data: { reason: tokenResult.reason },
          },
        }),
      );
      return;
    }

    // Parse request body
    const body = await readBody(req);
    let rpcRequest: {
      jsonrpc: string;
      id?: number | string;
      method: string;
      params?: unknown;
    };

    try {
      rpcRequest = JSON.parse(body);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
        }),
      );
      return;
    }

    // Route the request
    const response = await this.routeRequest(rpcRequest, tokenResult.profileConfig, tokenResult.profile);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: rpcRequest.id, ...response }));
  }

  private handleSse(req: IncomingMessage, res: ServerResponse): void {
    // SSE placeholder for server→client notifications
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("data: {\"type\":\"connected\"}\n\n");

    req.on("close", () => {
      res.end();
    });
  }

  private async routeRequest(
    rpcRequest: { method: string; params?: unknown; id?: number | string },
    profileConfig: { allow: string[] },
    profileName: string,
  ): Promise<{ result?: unknown; error?: unknown }> {
    const { method, params } = rpcRequest;

    switch (method) {
      case "initialize":
        return {
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "omni-mcp", version: "0.1.0" },
          },
        };

      case "notifications/initialized":
        return { result: {} };

      case "tools/list":
        return { result: await this.handleToolsList(profileConfig) };

      case "tools/call":
        return await this.handleToolCall(
          params as { name: string; arguments?: Record<string, unknown> },
          profileConfig,
        );

      default:
        return {
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  private async handleToolsList(
    profileConfig: { allow: string[] },
  ): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }> {
    const allServerNames = Array.from(this.adapters.keys());
    const allowedServers = getAllowedServers(profileConfig, allServerNames);
    const tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];

    for (const serverName of allowedServers) {
      const adapter = this.adapters.get(serverName);
      if (!adapter || adapter.status !== "connected") continue;

      const serverTools = await adapter.listTools();
      for (const tool of serverTools) {
        tools.push({
          name: `${serverName}${TOOL_SEPARATOR}${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }

    return { tools };
  }

  private async handleToolCall(
    params: { name: string; arguments?: Record<string, unknown> },
    profileConfig: { allow: string[] },
  ): Promise<{ result?: unknown; error?: unknown }> {
    if (!params?.name) {
      return { error: { code: -32602, message: "Missing tool name" } };
    }

    const separatorIndex = params.name.indexOf(TOOL_SEPARATOR);
    if (separatorIndex === -1) {
      return {
        error: { code: -32601, message: `Invalid tool name format: "${params.name}". Expected "server__tool"` },
      };
    }

    const serverName = params.name.slice(0, separatorIndex);
    const toolName = params.name.slice(separatorIndex + TOOL_SEPARATOR.length);

    // Check server exists
    const adapter = this.adapters.get(serverName);
    if (!adapter) {
      return {
        error: { code: -32601, message: `Unknown server: "${serverName}"` },
      };
    }

    // Check server is in profile
    if (!isServerAllowed(serverName, profileConfig)) {
      return {
        error: { code: -32603, message: "Server not available in active profile" },
      };
    }

    // Check server is connected
    if (adapter.status !== "connected") {
      return {
        error: {
          code: -32603,
          message: `Upstream server '${serverName}' is currently unavailable`,
          data: { server: serverName, status: adapter.status, restarts: adapter.restarts },
        },
      };
    }

    // Forward the call
    try {
      const result = await adapter.callTool(toolName, params.arguments ?? {});
      return { result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        error: { code: -32603, message: `Tool call failed: ${message}` },
      };
    }
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
