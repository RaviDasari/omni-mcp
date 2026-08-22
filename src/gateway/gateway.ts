import { randomUUID } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, sep } from "node:path";
import type { OmniMcpConfig, ProfileConfig, ServerConfig, TokenConfig } from "../config/index.js";
import { mergeSecrets, redactConfig, validateConfig } from "../config/index.js";
import { resolveToken, isServerAllowed, getAllowedServers } from "../auth/index.js";
import type { ServerAdapter, Tool, ToolResult } from "../transport/index.js";
import { Logger } from "../logger.js";
import { VERSION } from "../version.js";
import { buildIdeSnippets } from "../ide/snippets.js";
import {
  TrafficLog,
  type TrafficLogEvent,
  type TrafficLogFilters,
  type TrafficLogGroupBy,
  type TrafficLogQuery,
} from "./traffic-log.js";

const TOOL_SEPARATOR = "__";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

export interface GatewayOptions {
  config: OmniMcpConfig;
  adapters: Map<string, ServerAdapter>;
  configPath?: string;
  uiDir?: string;
  version?: string;
  trafficLogDir?: string;
  onSaveConfig?: (next: OmniMcpConfig) => Promise<void>;
  onReloadFromDisk?: () => Promise<{ warnings: string[] }>;
}

export class Gateway {
  private config: OmniMcpConfig;
  private adapters: Map<string, ServerAdapter>;
  private server: Server | null = null;
  private logger = new Logger("omni-mcp");
  private startTime = 0;
  private sseSessions = new Map<string, ServerResponse>();
  private configPath?: string;
  private uiDir?: string;
  private version: string;
  private trafficLog: TrafficLog;
  private onSaveConfig?: (next: OmniMcpConfig) => Promise<void>;
  private onReloadFromDisk?: () => Promise<{ warnings: string[] }>;

  constructor(options: GatewayOptions) {
    this.config = options.config;
    this.adapters = options.adapters;
    this.configPath = options.configPath;
    this.uiDir = options.uiDir;
    this.version = options.version ?? VERSION;
    this.trafficLog = new TrafficLog(options.config.trafficLog, options.trafficLogDir);
    this.onSaveConfig = options.onSaveConfig;
    this.onReloadFromDisk = options.onReloadFromDisk;
  }

  async start(): Promise<void> {
    this.startTime = Date.now();
    this.trafficLog.start();

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
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.server = null;
          resolve();
        });

        setTimeout(() => {
          this.server?.closeAllConnections();
          resolve();
        }, this.config.shutdownGracePeriodMs);
      });
    }
    await this.trafficLog.stop();
  }

  getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  updateConfig(config: OmniMcpConfig): void {
    this.config = config;
    this.trafficLog.updateConfig(config.trafficLog);
  }

  async reloadFromDisk(): Promise<{ warnings: string[] }> {
    if (!this.onReloadFromDisk) {
      throw new Error("Reload from disk is not available");
    }
    return this.onReloadFromDisk();
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/_health" && req.method === "GET") {
      return this.handleHealth(res);
    }
    if (url.pathname === "/_ready" && req.method === "GET") {
      return this.handleReady(res);
    }

    if (url.pathname.startsWith("/api/")) {
      return this.handleApi(req, res, url);
    }

    if (url.pathname === "/mcp" && req.method === "POST") {
      return this.handleMcp(req, res);
    }

    if (url.pathname === "/mcp" && req.method === "GET") {
      return this.handleSse(req, res);
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const served = this.tryServeUi(req, res, url.pathname);
      if (served) return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private healthPayload(): Record<string, unknown> {
    const servers: Record<string, unknown> = {};
    for (const [name, serverConfig] of Object.entries(this.config.servers)) {
      const adapter = this.adapters.get(name);
      const enabled = serverConfig.enabled !== false;
      servers[name] = {
        enabled,
        status: enabled ? (adapter?.status ?? "error") : "disabled",
        transport: serverConfig.type,
        restarts: adapter?.restarts ?? 0,
      };
    }

    return {
      status: "ok",
      version: this.version,
      uptime: this.getUptime(),
      host: this.config.host,
      port: this.config.port,
      configPath: this.configPath,
      defaultProfile: this.config.defaultProfile,
      servers,
    };
  }

  private handleHealth(res: ServerResponse): void {
    json(res, 200, this.healthPayload());
  }

  private handleReady(res: ServerResponse): void {
    const hasConnected = Array.from(this.adapters.values()).some((a) => a.status === "connected");

    if (hasConnected) {
      json(res, 200, { status: "ready" });
    } else {
      json(res, 503, { status: "not_ready" });
    }
  }

  private async handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const method = req.method ?? "GET";
    const mutating = method !== "GET" && method !== "HEAD";
    const trafficLogRequest = url.pathname === "/api/traffic-logs" ||
      url.pathname === "/api/traffic-logs/summary";
    const directToolsRequest = /^\/api\/servers\/[^/]+\/tools(?:\/call)?$/.test(url.pathname);

    if ((trafficLogRequest || directToolsRequest) && !isLoopback(req)) {
      json(res, 403, { error: "This endpoint is only available from localhost" });
      return;
    }

    if (mutating && !isLoopback(req)) {
      json(res, 403, {
        error: "Management writes are only allowed from localhost. Binding 0.0.0.0 without auth is unsafe.",
      });
      return;
    }

    const path = url.pathname;
    const serverToolsMatch = path.match(/^\/api\/servers\/([^/]+)\/tools$/);
    const serverToolCallMatch = path.match(/^\/api\/servers\/([^/]+)\/tools\/call$/);
    const serverEnabledMatch = path.match(/^\/api\/servers\/([^/]+)\/enabled$/);
    const serverMatch = path.match(/^\/api\/servers\/([^/]+)$/);
    const profileMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
    const tokenMatch = path.match(/^\/api\/tokens\/([^/]+)$/);

    try {
      if (path === "/api/health" && method === "GET") {
        json(res, 200, this.healthPayload());
        return;
      }

      if (path === "/api/config" && method === "GET") {
        json(res, 200, { config: redactConfig(this.config) });
        return;
      }

      if (path === "/api/config" && method === "PUT") {
        const body = await readJson(req);
        await this.saveIncomingConfig(body);
        json(res, 200, { config: redactConfig(this.config) });
        return;
      }

      if (path === "/api/reload" && method === "POST") {
        if (!this.onReloadFromDisk) {
          json(res, 400, { error: "Reload from disk is not available" });
          return;
        }
        const result = await this.onReloadFromDisk();
        json(res, 200, { ok: true, warnings: result.warnings, config: redactConfig(this.config) });
        return;
      }

      if (path === "/api/ide-snippets" && method === "GET") {
        const token = url.searchParams.get("token") ?? "default";
        json(
          res,
          200,
          buildIdeSnippets({
            token,
            port: this.config.port,
            host: this.config.host,
          }),
        );
        return;
      }

      if (path === "/api/traffic-logs" && method === "GET") {
        const query = parseTrafficLogQuery(url.searchParams);
        json(res, 200, await this.trafficLog.query(query));
        return;
      }

      if (path === "/api/traffic-logs/summary" && method === "GET") {
        const { filters, groupBy } = parseTrafficLogSummaryQuery(url.searchParams);
        json(res, 200, await this.trafficLog.summarize(filters, groupBy));
        return;
      }

      if (path === "/api/traffic-logs" && method === "DELETE") {
        await this.trafficLog.clear();
        json(res, 200, { ok: true, deleted: true });
        return;
      }

      if (serverToolsMatch && method === "GET") {
        const name = decodeURIComponent(serverToolsMatch[1]!);
        const target = this.directToolTarget(name);
        if ("error" in target) {
          json(res, target.status, { error: target.error });
          return;
        }
        const tools = await target.adapter.listTools();
        json(res, 200, {
          server: name,
          status: target.adapter.status,
          transport: target.config.type,
          restarts: target.adapter.restarts,
          tools,
        });
        return;
      }

      if (serverToolCallMatch && method === "POST") {
        const name = decodeURIComponent(serverToolCallMatch[1]!);
        const target = this.directToolTarget(name);
        if ("error" in target) {
          json(res, target.status, { error: target.error });
          return;
        }

        const body = await readJson(req);
        if (!isRecord(body) || typeof body.tool !== "string" || body.tool.length === 0) {
          json(res, 400, { error: "Validation failed: tool must be a non-empty string" });
          return;
        }
        if (
          body.arguments !== undefined &&
          (!isRecord(body.arguments) || Array.isArray(body.arguments))
        ) {
          json(res, 400, { error: "Validation failed: arguments must be an object" });
          return;
        }

        const tools = await target.adapter.listTools();
        if (!tools.some((tool) => tool.name === body.tool)) {
          json(res, 404, { error: `Unknown tool "${body.tool}" on server "${name}"` });
          return;
        }

        const startedAt = Date.now();
        try {
          const result = await target.adapter.callTool(
            body.tool,
            (body.arguments as Record<string, unknown> | undefined) ?? {},
          );
          json(res, 200, {
            server: name,
            tool: body.tool,
            durationMs: Date.now() - startedAt,
            result,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          json(res, 502, { error: `Tool call failed: ${message}` });
        }
        return;
      }

      if (serverEnabledMatch && method === "PUT") {
        const name = decodeURIComponent(serverEnabledMatch[1]!);
        const body = (await readJson(req)) as { enabled?: unknown };
        const next = structuredClone(this.config);
        if (!(name in next.servers)) {
          json(res, 404, { error: `Unknown server "${name}"` });
          return;
        }
        if (typeof body.enabled !== "boolean") {
          json(res, 400, { error: "Validation failed: enabled must be a boolean" });
          return;
        }
        next.servers[name]!.enabled = body.enabled;
        await this.saveIncomingConfig(next);
        json(res, 200, {
          config: redactConfig(this.config),
          health: this.healthPayload(),
        });
        return;
      }

      if (serverMatch && method === "PUT") {
        const name = decodeURIComponent(serverMatch[1]!);
        const body = (await readJson(req)) as ServerConfig;
        const next = structuredClone(this.config);
        next.servers[name] = body;
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.config) });
        return;
      }

      if (serverMatch && method === "DELETE") {
        const name = decodeURIComponent(serverMatch[1]!);
        const next = structuredClone(this.config);
        if (!(name in next.servers)) {
          json(res, 404, { error: `Unknown server "${name}"` });
          return;
        }
        delete next.servers[name];
        for (const profile of Object.values(next.profiles)) {
          profile.allow = profile.allow.filter((s) => s !== name);
        }
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.config) });
        return;
      }

      if (profileMatch && method === "PUT") {
        const name = decodeURIComponent(profileMatch[1]!);
        const body = (await readJson(req)) as ProfileConfig;
        const next = structuredClone(this.config);
        next.profiles[name] = body;
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.config) });
        return;
      }

      if (profileMatch && method === "DELETE") {
        const name = decodeURIComponent(profileMatch[1]!);
        if (name === "default") {
          json(res, 400, { error: 'The "default" profile cannot be deleted' });
          return;
        }
        const next = structuredClone(this.config);
        if (!(name in next.profiles)) {
          json(res, 404, { error: `Unknown profile "${name}"` });
          return;
        }
        delete next.profiles[name];
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.config) });
        return;
      }

      if (tokenMatch && method === "PUT") {
        const name = decodeURIComponent(tokenMatch[1]!);
        const body = (await readJson(req)) as TokenConfig;
        const next = structuredClone(this.config);
        next.tokens[name] = body;
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.config) });
        return;
      }

      if (tokenMatch && method === "DELETE") {
        const name = decodeURIComponent(tokenMatch[1]!);
        if (name === "default") {
          json(res, 400, { error: 'The "default" token cannot be deleted' });
          return;
        }
        const next = structuredClone(this.config);
        if (!(name in next.tokens)) {
          json(res, 404, { error: `Unknown token "${name}"` });
          return;
        }
        delete next.tokens[name];
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.config) });
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status = message.startsWith("Validation failed") ? 400 : 500;
      json(res, status, { error: message });
    }
  }

  private async saveIncomingConfig(raw: unknown): Promise<void> {
    if (!this.onSaveConfig) {
      throw new Error("Config writes are not enabled");
    }

    const draft =
      raw && typeof raw === "object" && "config" in (raw as object)
        ? (raw as { config: unknown }).config
        : raw;

    const candidate = mergeSecrets(draft as OmniMcpConfig, this.config);
    const result = validateConfig(candidate);
    if (!result.config) {
      throw new Error(`Validation failed: ${result.errors.map((e) => e.message).join("; ")}`);
    }

    await this.onSaveConfig(result.config);
    this.config = result.config;
  }

  private directToolTarget(name: string):
    | { adapter: ServerAdapter; config: ServerConfig }
    | { status: number; error: string } {
    const config = this.config.servers[name];
    if (!config) {
      return { status: 404, error: `Unknown server "${name}"` };
    }
    if (config.enabled === false) {
      return { status: 404, error: `Server "${name}" is disabled` };
    }
    const adapter = this.adapters.get(name);
    if (!adapter) {
      return { status: 409, error: `Server "${name}" is not initialized` };
    }
    if (adapter.status !== "connected") {
      return {
        status: 409,
        error: `Server "${name}" is not connected (status: ${adapter.status})`,
      };
    }
    return { adapter, config };
  }

  private tryServeUi(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
    if (!this.uiDir) return false;

    const decoded = decodeURIComponent(pathname);
    const requestPath = decoded === "/" ? "/index.html" : decoded;
    const candidate = safeJoin(this.uiDir, requestPath);

    if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
      const body = readFileSync(candidate);
      const type = MIME[extname(candidate).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
      if (req.method === "HEAD") res.end();
      else res.end(body);
      return true;
    }

    const indexPath = join(this.uiDir, "index.html");
    if (existsSync(indexPath)) {
      const body = readFileSync(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      if (req.method === "HEAD") res.end();
      else res.end(body);
      return true;
    }

    return false;
  }

  private async handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const sessionId = url.searchParams.get("sessionId");

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
    const response = await this.routeRequest(
      rpcRequest,
      tokenResult.profileConfig,
      tokenResult.profile,
      authHeader?.trim() ? (tokenResult.tokenName ?? "") : "",
    );
    const jsonRpcResponse = { jsonrpc: "2.0", id: rpcRequest.id, ...response };

    // If there is an active SSE session, send response over SSE and return 202 Accepted to POST
    if (sessionId && this.sseSessions.has(sessionId)) {
      const sseRes = this.sseSessions.get(sessionId);
      if (sseRes) {
        sseRes.write(`event: message\ndata: ${JSON.stringify(jsonRpcResponse)}\n\n`);
      }
      res.writeHead(202, { "Content-Type": "text/plain" });
      res.end("Accepted");
    } else {
      // Fallback/Direct mode: return response directly in the POST body
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(jsonRpcResponse));
    }
  }

  private handleSse(req: IncomingMessage, res: ServerResponse): void {
    // Authenticate
    const authHeader = req.headers["authorization"] as string | undefined;
    const tokenResult = resolveToken(authHeader, this.config);

    if (tokenResult.status === "rejected") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const sessionId = randomUUID();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Write the standard SSE endpoint event to tell client where to send POSTs
    const postUrl = `/mcp?sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${postUrl}\n\n`);

    this.sseSessions.set(sessionId, res);

    req.on("close", () => {
      this.sseSessions.delete(sessionId);
      res.end();
    });
  }

  private async routeRequest(
    rpcRequest: { method: string; params?: unknown; id?: number | string },
    profileConfig: { allow: string[] },
    profileName: string,
    tokenName: string,
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
          profileName,
          tokenName,
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
    profileName: string,
    tokenName: string,
  ): Promise<{ result?: unknown; error?: unknown }> {
    const startedAt = Date.now();
    const namespacedTool = typeof params?.name === "string" ? params.name : "";
    const separatorIndex = namespacedTool.indexOf(TOOL_SEPARATOR);
    const serverName = separatorIndex === -1 ? "" : namespacedTool.slice(0, separatorIndex);
    const toolName = separatorIndex === -1
      ? namespacedTool
      : namespacedTool.slice(separatorIndex + TOOL_SEPARATOR.length);

    const response = await this.executeToolCall(params, profileConfig);
    const errorCode = getErrorCode(response.error);
    const event: TrafficLogEvent = {
      ts: new Date().toISOString(),
      token: tokenName,
      profile: profileName,
      server: serverName,
      tool: toolName,
      namespacedTool,
      durationMs: Date.now() - startedAt,
      outcome: response.error === undefined ? "ok" : "error",
      ...(errorCode === undefined ? {} : { errorCode }),
    };
    await this.trafficLog.append(event).catch((error) => {
      this.logger.warn(
        `Failed to write traffic log: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    });
    return response;
  }

  private async executeToolCall(
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

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseTrafficLogQuery(params: URLSearchParams): TrafficLogQuery {
  const filters = parseTrafficLogFilters(params);
  return {
    ...filters,
    offset: parseIntegerParam(params, "offset", 0, 0),
    limit: parseIntegerParam(params, "limit", 100, 1, 200),
  };
}

function parseTrafficLogSummaryQuery(params: URLSearchParams): {
  filters: TrafficLogFilters;
  groupBy: TrafficLogGroupBy;
} {
  const rawGroupBy = params.get("groupBy") ?? "tool";
  if (!["tool", "server", "token", "profile"].includes(rawGroupBy)) {
    throw new Error("Validation failed: invalid groupBy");
  }
  return {
    filters: parseTrafficLogFilters(params),
    groupBy: rawGroupBy as TrafficLogGroupBy,
  };
}

function parseTrafficLogFilters(params: URLSearchParams): TrafficLogFilters {
  const now = Date.now();
  const from = parseTimestampParam(params, "from", now - 24 * 60 * 60 * 1000);
  const to = parseTimestampParam(params, "to", now);
  if (from > to) throw new Error("Validation failed: from must not be after to");

  return {
    from,
    to,
    ...optionalFilter(params, "token"),
    ...optionalFilter(params, "profile"),
    ...optionalFilter(params, "server"),
    ...optionalFilter(params, "tool"),
  };
}

function optionalFilter(
  params: URLSearchParams,
  name: "token" | "profile" | "server" | "tool",
): Partial<Record<typeof name, string>> {
  const value = params.get(name);
  return value === null || value === "" ? {} : { [name]: value };
}

function parseTimestampParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Date.parse(raw);
  if (!Number.isFinite(value)) throw new Error(`Validation failed: Invalid ${name} timestamp`);
  return value;
}

function parseIntegerParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`Validation failed: invalid ${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Validation failed: invalid ${name}`);
  }
  return value;
}

function getErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" && Number.isInteger(code) ? code : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === ":ffff:127.0.0.1" ||
    addr === "::ffff:127.0.0.1"
  );
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Validation failed: invalid JSON");
  }
}

function safeJoin(root: string, requestPath: string): string | undefined {
  const cleaned = normalize(requestPath).replace(/^[/\\]+/, "");
  const full = join(root, cleaned);
  const rel = relative(root, full);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`)) return undefined;
  return full;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
