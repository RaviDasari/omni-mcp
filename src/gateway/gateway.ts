import { randomUUID } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import type {
  OmniMcpConfig,
  ProfileConfig,
  SecretStore,
  SecretStoreOptions,
  ServerConfig,
  TokenConfig,
  VariableStoreOptions,
  VariableType,
} from "../config/index.js";
import {
  KeychainSecretStore,
  assertSecretName,
  collectSecretUsages,
  createSecretStore,
  mergeSecrets,
  migrateSecretStore,
  redactConfig,
  secretReferenceName,
  validateConfig,
  VariableStore,
} from "../config/index.js";
import { DEFAULT_SECRETS_PATH, DEFAULT_VARIABLES_PATH } from "../cli/config-path.js";
import { resolveToken, isServerAllowed, isToolAllowed, getAllowedServers } from "../auth/index.js";
import type { ServerAdapter, Tool, ToolResult } from "../transport/index.js";
import { Logger } from "../logger.js";
import { VERSION } from "../version.js";
import { buildIdeSnippets } from "../ide/snippets.js";
import { toonifyResult } from "../toon.js";
import {
  TrafficLog,
  type TrafficLogEvent,
  type TrafficLogFilters,
  type TrafficLogGroupBy,
  type TrafficLogQuery,
} from "./traffic-log.js";

const TOOL_SEPARATOR = "__";
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

interface VariablesPayload {
  secretBackend: "file" | "keychain";
  secretPath?: string;
  variablesPath: string;
  keychainService: string;
  keychainSupported: boolean;
  secretCount: number;
  plainCount: number;
  variables: Array<{
    name: string;
    type: VariableType;
    set: boolean;
    value?: string;
    usages: Array<{ path: string; server?: string }>;
  }>;
}

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
  rawConfig?: OmniMcpConfig;
  adapters: Map<string, ServerAdapter>;
  configPath?: string;
  uiDir?: string;
  version?: string;
  trafficLogDir?: string;
  /** Enabled servers that were not started, keyed by name, with the reasons. */
  serverIssues?: Record<string, string[]>;
  globalIssues?: string[];
  secretStoreOptions?: SecretStoreOptions;
  variableStoreOptions?: VariableStoreOptions;
  onSaveConfig?: (next: OmniMcpConfig) => Promise<OmniMcpConfig | void>;
  onReloadFromDisk?: () => Promise<{ warnings: string[] }>;
}

export class Gateway {
  private config: OmniMcpConfig;
  private rawConfig: OmniMcpConfig;
  private adapters: Map<string, ServerAdapter>;
  private server: Server | null = null;
  private logger = new Logger("omni-mcp");
  private startTime = 0;
  private sseSessions = new Map<string, ServerResponse>();
  private configPath?: string;
  private uiDir?: string;
  private version: string;
  private trafficLog: TrafficLog;
  private serverIssues: Record<string, string[]>;
  private globalIssues: string[];
  private secretStoreOptions: SecretStoreOptions;
  private variableStoreOptions: VariableStoreOptions;
  private onSaveConfig?: (next: OmniMcpConfig) => Promise<OmniMcpConfig | void>;
  private onReloadFromDisk?: () => Promise<{ warnings: string[] }>;

  constructor(options: GatewayOptions) {
    this.config = options.config;
    this.rawConfig = options.rawConfig ?? structuredClone(options.config);
    this.adapters = options.adapters;
    this.configPath = options.configPath ? resolve(options.configPath) : undefined;
    this.uiDir = options.uiDir;
    this.version = options.version ?? VERSION;
    this.trafficLog = new TrafficLog(options.config.trafficLog, options.trafficLogDir);
    this.serverIssues = options.serverIssues ?? {};
    this.globalIssues = options.globalIssues ?? [];
    this.secretStoreOptions = options.secretStoreOptions ?? {};
    this.variableStoreOptions = options.variableStoreOptions ?? {};
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

  updateConfig(
    config: OmniMcpConfig,
    rawConfig: OmniMcpConfig = config,
    issues: { serverIssues?: Record<string, string[]>; globalIssues?: string[] } = {},
  ): void {
    this.config = config;
    this.rawConfig = rawConfig;
    this.serverIssues = issues.serverIssues ?? {};
    this.globalIssues = issues.globalIssues ?? [];
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
      return this.handlePublicHealth(res);
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
      const issues = enabled ? this.serverIssues[name] : undefined;
      servers[name] = {
        enabled,
        cliEnabled: serverConfig.cli?.enabled === true,
        toonEnabled: serverConfig.toon?.enabled === true,
        status: !enabled ? "disabled" : issues ? "config-error" : (adapter?.status ?? "error"),
        ...(issues ? { issues } : {}),
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
      ...(this.globalIssues.length > 0 ? { issues: this.globalIssues } : {}),
    };
  }

  private handleHealth(res: ServerResponse): void {
    json(res, 200, this.healthPayload());
  }

  private handlePublicHealth(res: ServerResponse): void {
    json(res, 200, {
      status: "ok",
      version: this.version,
      uptime: this.getUptime(),
    });
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

    if (!isLoopback(req)) {
      json(res, 403, { error: "This endpoint is only available from localhost" });
      return;
    }

    const path = url.pathname;
    const serverToolsMatch = path.match(/^\/api\/servers\/([^/]+)\/tools$/);
    const serverToolCallMatch = path.match(/^\/api\/servers\/([^/]+)\/tools\/call$/);
    const serverToolEnabledMatch = path.match(/^\/api\/servers\/([^/]+)\/tools\/([^/]+)\/enabled$/);
    const cliServerToolsMatch = path.match(/^\/api\/cli\/servers\/([^/]+)\/tools$/);
    const cliServerToolCallMatch = path.match(/^\/api\/cli\/servers\/([^/]+)\/tools\/call$/);
    const serverCliEnabledMatch = path.match(/^\/api\/servers\/([^/]+)\/cli-enabled$/);
    const serverToonEnabledMatch = path.match(/^\/api\/servers\/([^/]+)\/toon-enabled$/);
    const serverEnabledMatch = path.match(/^\/api\/servers\/([^/]+)\/enabled$/);
    const serverMatch = path.match(/^\/api\/servers\/([^/]+)$/);
    const profileMatch = path.match(/^\/api\/profiles\/([^/]+)$/);
    const profileToolEnabledMatch = path.match(
      /^\/api\/profiles\/([^/]+)\/servers\/([^/]+)\/tools\/([^/]+)\/enabled$/,
    );
    const profileApplyToolsMatch = path.match(/^\/api\/profiles\/([^/]+)\/apply-deny-tools$/);
    const tokenMatch = path.match(/^\/api\/tokens\/([^/]+)$/);
    const variableTypeMatch = path.match(/^\/api\/variables\/([^/]+)\/type$/);
    const variableMatch = path.match(/^\/api\/variables\/([^/]+)$/);

    try {
      if (path === "/api/health" && method === "GET") {
        json(res, 200, this.healthPayload());
        return;
      }

      if (path === "/api/variables" && method === "GET") {
        json(res, 200, this.variablePayload());
        return;
      }

      if (path === "/api/variables/sync" && method === "POST") {
        this.activeVariableStore().list();
        await this.reapplyRawConfig();
        json(res, 200, { ok: true, ...this.variablePayload() });
        return;
      }

      if (path === "/api/variables/import-keychain" && method === "POST") {
        const body = await readJson(req);
        if (
          !isRecord(body) ||
          typeof body.service !== "string" ||
          typeof body.account !== "string" ||
          typeof body.name !== "string"
        ) {
          json(res, 400, { error: "Validation failed: service, account, and name are required" });
          return;
        }
        const external = new KeychainSecretStore(body.service, this.secretStoreOptions);
        const value = external.readAccount(body.account);
        if (!value) {
          json(res, 404, { error: `Keychain item ${body.service}/${body.account} was not found` });
          return;
        }
        this.activeVariableStore().set(body.name, value, "secret");
        await this.reapplyRawConfig();
        json(res, 200, { ok: true, ...this.variablePayload() });
        return;
      }

      if (path === "/api/variables/secret-backend" && method === "POST") {
        const body = await readJson(req);
        if (!isRecord(body) || (body.backend !== "file" && body.backend !== "keychain")) {
          json(res, 400, { error: 'Validation failed: backend must be "file" or "keychain"' });
          return;
        }
        if (body.backend === this.rawConfig.secretBackend.backend) {
          json(res, 200, { ok: true, migrated: 0, ...this.variablePayload() });
          return;
        }
        const destinationConfig: OmniMcpConfig["secretBackend"] = {
          ...this.rawConfig.secretBackend,
          backend: body.backend,
        };
        const sourceStore = this.activeSecretStore();
        const destinationStore = createSecretStore(destinationConfig, this.secretStoreOptions);
        const migrated = migrateSecretStore(sourceStore, destinationStore);
        const next = structuredClone(this.rawConfig);
        next.secretBackend = destinationConfig;
        try {
          await this.saveIncomingConfig(next);
        } catch (error) {
          migrateSecretStore(destinationStore, sourceStore);
          throw error;
        }
        json(res, 200, { ok: true, migrated, ...this.variablePayload() });
        return;
      }

      if (path === "/api/variables/secret-backend" && method === "GET") {
        const backend = url.searchParams.get("backend");
        if (backend !== "file" && backend !== "keychain") {
          json(res, 400, { error: 'backend query must be "file" or "keychain"' });
          return;
        }
        json(res, 200, {
          from: this.rawConfig.secretBackend.backend,
          to: backend,
          count: this.activeSecretStore().list().length,
          keychainSupported: process.platform === "darwin",
        });
        return;
      }

      if (path === "/api/variables/migrate-inline" && method === "GET") {
        const candidates = inlineSecretCandidates(this.rawConfig);
        const variables = this.activeVariableStore();
        json(res, 200, {
          candidates: candidates.map(withoutSecretValue),
          conflicts: migrationConflicts(candidates, variables),
        });
        return;
      }

      if (path === "/api/variables/migrate-inline" && method === "POST") {
        const body = await readJson(req);
        const renames = isRecord(body) && isRecord(body.renames) ? body.renames : {};
        const candidates = inlineSecretCandidates(this.rawConfig).map((candidate) => {
          const renamed = renames[candidate.name];
          if (renamed !== undefined) {
            if (typeof renamed !== "string") throw new Error("Validation failed: rename values must be strings");
            assertSecretName(renamed);
            return { ...candidate, name: renamed };
          }
          return candidate;
        });
        const store = this.activeVariableStore();
        const conflicts = migrationConflicts(candidates, store);
        if (conflicts.length > 0) {
          json(res, 409, { error: "Migration has variable-name collisions", conflicts });
          return;
        }
        const next = structuredClone(this.rawConfig);
        const previous = new Map<string, string | undefined>();
        try {
          for (const candidate of candidates) {
            if (!previous.has(candidate.name)) previous.set(candidate.name, store.get(candidate.name));
            store.set(candidate.name, candidate.value, "secret");
            applyInlineReference(next, candidate);
          }
          await this.saveIncomingConfig(next);
        } catch (error) {
          for (const [name, oldValue] of previous) {
            if (oldValue === undefined) store.delete(name);
            else store.set(name, oldValue, "secret");
          }
          throw error;
        }
        json(res, 200, { ok: true, migrated: candidates.length, ...this.variablePayload() });
        return;
      }

      if (variableTypeMatch && method === "PUT") {
        const name = decodeURIComponent(variableTypeMatch[1]!);
        const body = await readJson(req);
        if (!isRecord(body) || (body.type !== "secret" && body.type !== "plain")) {
          json(res, 400, { error: 'Validation failed: type must be "secret" or "plain"' });
          return;
        }
        this.activeVariableStore().convert(name, body.type);
        await this.reapplyRawConfig();
        json(res, 200, { ok: true, ...this.variablePayload() });
        return;
      }

      if (
        variableMatch &&
        !["sync", "secret-backend", "import-keychain", "migrate-inline"].includes(variableMatch[1]!) &&
        method === "PUT"
      ) {
        const name = decodeURIComponent(variableMatch[1]!);
        const body = await readJson(req);
        if (
          !isRecord(body) ||
          typeof body.value !== "string" ||
          body.value.length === 0 ||
          (body.type !== undefined && body.type !== "secret" && body.type !== "plain")
        ) {
          json(res, 400, { error: "Validation failed: value and valid type are required" });
          return;
        }
        this.activeVariableStore().set(
          name,
          body.value,
          (body.type as VariableType | undefined) ?? "secret",
        );
        await this.reapplyRawConfig();
        json(res, 200, { ok: true, ...this.variablePayload() });
        return;
      }

      if (
        variableMatch &&
        !["sync", "secret-backend", "import-keychain", "migrate-inline"].includes(variableMatch[1]!) &&
        method === "GET"
      ) {
        const name = decodeURIComponent(variableMatch[1]!);
        const variable = this.variablePayload().variables.find((item) => item.name === name);
        json(res, variable ? 200 : 404, variable ?? { error: `Variable "${name}" was not found` });
        return;
      }

      if (
        variableMatch &&
        !["sync", "secret-backend", "import-keychain", "migrate-inline"].includes(variableMatch[1]!) &&
        method === "DELETE"
      ) {
        const name = decodeURIComponent(variableMatch[1]!);
        const usages = collectSecretUsages(this.rawConfig)[name] ?? [];
        if (usages.length > 0) {
          json(res, 409, { error: `Variable "${name}" is still referenced`, usages });
          return;
        }
        const deleted = this.activeVariableStore().delete(name);
        json(res, deleted ? 200 : 404, deleted
          ? { ok: true, deleted: true, ...this.variablePayload() }
          : { error: `Variable "${name}" was not found` });
        return;
      }

      if (path === "/api/config" && method === "GET") {
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      if (path === "/api/config" && method === "PUT") {
        const body = await readJson(req);
        await this.saveIncomingConfig(body);
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      if (path === "/api/reload" && method === "POST") {
        if (!this.onReloadFromDisk) {
          json(res, 400, { error: "Reload from disk is not available" });
          return;
        }
        const result = await this.onReloadFromDisk();
        json(res, 200, { ok: true, warnings: result.warnings, config: redactConfig(this.rawConfig) });
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

      if (path === "/api/cli/servers" && method === "GET") {
        const servers = Object.entries(this.config.servers)
          .filter(([, server]) => server.cli?.enabled === true)
          .map(([name, server]) => {
            const adapter = this.adapters.get(name);
            return {
              name,
              transport: server.type,
              enabled: server.enabled !== false,
              cliEnabled: true,
              status: server.enabled === false
                ? "disabled"
                : this.serverIssues[name] ? "config-error" : (adapter?.status ?? "error"),
              toolCount: adapter?.status === "connected" ? undefined : 0,
            };
          });
        for (const server of servers) {
          if (server.status === "connected") {
            server.toolCount = (await this.adapters.get(server.name)!.listTools())
              .filter((tool) => !this.isGloballyDisabled(server.name, tool.name)).length;
          }
        }
        json(res, 200, { servers });
        return;
      }

      if (cliServerToolsMatch && method === "GET") {
        const name = decodeURIComponent(cliServerToolsMatch[1]!);
        const target = this.cliToolTarget(name);
        if ("error" in target) {
          json(res, target.status, { error: target.error });
          return;
        }
        const tools = (await target.adapter.listTools())
          .filter((tool) => !this.isGloballyDisabled(name, tool.name));
        json(res, 200, {
          server: name,
          status: target.adapter.status,
          transport: target.config.type,
          restarts: target.adapter.restarts,
          tools,
        });
        return;
      }

      if (cliServerToolCallMatch && method === "POST") {
        const name = decodeURIComponent(cliServerToolCallMatch[1]!);
        const startedAt = Date.now();
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
        const toolName = body.tool;
        const logCliCall = (outcome: "ok" | "error") =>
          this.appendTrafficEvent({
            source: "cli",
            token: "",
            profile: "",
            server: name,
            tool: toolName,
            namespacedTool: `${name}${TOOL_SEPARATOR}${toolName}`,
            durationMs: Date.now() - startedAt,
            outcome,
          });
        const target = this.cliToolTarget(name);
        if ("error" in target) {
          await logCliCall("error");
          json(res, target.status, { error: target.error });
          return;
        }
        if (this.isGloballyDisabled(name, toolName)) {
          await logCliCall("error");
          json(res, 403, { error: `Tool "${toolName}" is globally disabled` });
          return;
        }
        const tools = await target.adapter.listTools();
        if (!tools.some((tool) => tool.name === toolName)) {
          await logCliCall("error");
          json(res, 404, { error: `Unknown tool "${toolName}" on server "${name}"` });
          return;
        }
        try {
          const result = await target.adapter.callTool(
            toolName,
            (body.arguments as Record<string, unknown> | undefined) ?? {},
          );
          await logCliCall(result.isError ? "error" : "ok");
          json(res, 200, {
            server: name,
            tool: toolName,
            durationMs: Date.now() - startedAt,
            result: this.presentResult(name, result),
          });
        } catch (err) {
          await logCliCall("error");
          const message = err instanceof Error ? err.message : "Unknown error";
          json(res, 502, { error: `Tool call failed: ${message}` });
        }
        return;
      }

      if (serverToolsMatch && method === "GET") {
        const name = decodeURIComponent(serverToolsMatch[1]!);
        const target = this.directToolTarget(name);
        if ("error" in target) {
          json(res, target.status, { error: target.error });
          return;
        }
        const tools = (await target.adapter.listTools()).map((tool) => ({
          ...tool,
          enabled: !this.isGloballyDisabled(name, tool.name),
          deniedByProfiles: Object.entries(this.config.profiles)
            .filter(([, profile]) => (profile.denyTools?.[name] ?? []).includes(tool.name))
            .map(([profileName]) => profileName),
        }));
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
        if (this.isGloballyDisabled(name, body.tool)) {
          json(res, 403, { error: `Tool "${body.tool}" is globally disabled` });
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
            result: this.presentResult(name, result),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          json(res, 502, { error: `Tool call failed: ${message}` });
        }
        return;
      }

      if (serverToolEnabledMatch && method === "PUT") {
        const name = decodeURIComponent(serverToolEnabledMatch[1]!);
        const toolName = decodeURIComponent(serverToolEnabledMatch[2]!);
        const body = (await readJson(req)) as { enabled?: unknown };
        const next = structuredClone(this.rawConfig);
        const server = next.servers[name];
        if (!server) {
          json(res, 404, { error: `Unknown server "${name}"` });
          return;
        }
        if (typeof body.enabled !== "boolean") {
          json(res, 400, { error: "Validation failed: enabled must be a boolean" });
          return;
        }
        const disabled = new Set(server.disabledTools ?? []);
        if (body.enabled) disabled.delete(toolName);
        else disabled.add(toolName);
        server.disabledTools = [...disabled];
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig), health: this.healthPayload() });
        return;
      }

      if (serverEnabledMatch && method === "PUT") {
        const name = decodeURIComponent(serverEnabledMatch[1]!);
        const body = (await readJson(req)) as { enabled?: unknown };
        const next = structuredClone(this.rawConfig);
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
          config: redactConfig(this.rawConfig),
          health: this.healthPayload(),
        });
        return;
      }

      if (serverCliEnabledMatch && method === "PUT") {
        const name = decodeURIComponent(serverCliEnabledMatch[1]!);
        const body = (await readJson(req)) as { enabled?: unknown };
        const next = structuredClone(this.rawConfig);
        if (!(name in next.servers)) {
          json(res, 404, { error: `Unknown server "${name}"` });
          return;
        }
        if (typeof body.enabled !== "boolean") {
          json(res, 400, { error: "Validation failed: enabled must be a boolean" });
          return;
        }
        next.servers[name]!.cli = { enabled: body.enabled };
        await this.saveIncomingConfig(next);
        json(res, 200, {
          config: redactConfig(this.rawConfig),
          health: this.healthPayload(),
        });
        return;
      }

      if (serverToonEnabledMatch && method === "PUT") {
        const name = decodeURIComponent(serverToonEnabledMatch[1]!);
        const body = (await readJson(req)) as { enabled?: unknown };
        const next = structuredClone(this.rawConfig);
        if (!(name in next.servers)) {
          json(res, 404, { error: `Unknown server "${name}"` });
          return;
        }
        if (typeof body.enabled !== "boolean") {
          json(res, 400, { error: "Validation failed: enabled must be a boolean" });
          return;
        }
        next.servers[name]!.toon = { enabled: body.enabled };
        await this.saveIncomingConfig(next);
        json(res, 200, {
          config: redactConfig(this.rawConfig),
          health: this.healthPayload(),
        });
        return;
      }

      if (serverMatch && method === "PUT") {
        const name = decodeURIComponent(serverMatch[1]!);
        const body = (await readJson(req)) as ServerConfig;
        const next = structuredClone(this.rawConfig);
        const existing = next.servers[name];
        next.servers[name] = existing?.disabledTools && body.disabledTools === undefined
          ? { ...body, disabledTools: existing.disabledTools }
          : body;
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      if (serverMatch && method === "DELETE") {
        const name = decodeURIComponent(serverMatch[1]!);
        const next = structuredClone(this.rawConfig);
        if (!(name in next.servers)) {
          json(res, 404, { error: `Unknown server "${name}"` });
          return;
        }
        delete next.servers[name];
        for (const profile of Object.values(next.profiles)) {
          profile.allow = profile.allow.filter((s) => s !== name);
          if (profile.denyTools) delete profile.denyTools[name];
        }
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      if (profileToolEnabledMatch && method === "PUT") {
        const profileName = decodeURIComponent(profileToolEnabledMatch[1]!);
        const serverName = decodeURIComponent(profileToolEnabledMatch[2]!);
        const toolName = decodeURIComponent(profileToolEnabledMatch[3]!);
        const body = (await readJson(req)) as { enabled?: unknown };
        const next = structuredClone(this.rawConfig);
        const profile = next.profiles[profileName];
        if (!profile) {
          json(res, 404, { error: `Unknown profile "${profileName}"` });
          return;
        }
        if (!(serverName in next.servers)) {
          json(res, 404, { error: `Unknown server "${serverName}"` });
          return;
        }
        if (typeof body.enabled !== "boolean") {
          json(res, 400, { error: "Validation failed: enabled must be a boolean" });
          return;
        }
        const denied = new Set(profile.denyTools?.[serverName] ?? []);
        if (body.enabled) denied.delete(toolName);
        else denied.add(toolName);
        profile.denyTools ??= {};
        if (denied.size > 0) profile.denyTools[serverName] = [...denied];
        else delete profile.denyTools[serverName];
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      if (profileApplyToolsMatch && method === "POST") {
        const sourceName = decodeURIComponent(profileApplyToolsMatch[1]!);
        const body = await readJson(req);
        if (
          !isRecord(body) ||
          typeof body.server !== "string" ||
          !Array.isArray(body.targets) ||
          !body.targets.every((target) => typeof target === "string")
        ) {
          json(res, 400, { error: "Validation failed: server and targets are required" });
          return;
        }
        const next = structuredClone(this.rawConfig);
        const source = next.profiles[sourceName];
        if (!source) {
          json(res, 404, { error: `Unknown profile "${sourceName}"` });
          return;
        }
        if (!(body.server in next.servers)) {
          json(res, 404, { error: `Unknown server "${body.server}"` });
          return;
        }
        const applied: string[] = [];
        const skipped: string[] = [];
        for (const targetName of body.targets) {
          const target = next.profiles[targetName];
          if (!target) {
            json(res, 404, { error: `Unknown profile "${targetName}"` });
            return;
          }
          if (!target.allow.includes("*") && !target.allow.includes(body.server)) {
            skipped.push(targetName);
            continue;
          }
          target.denyTools ??= {};
          const sourceDenied = source.denyTools?.[body.server] ?? [];
          if (sourceDenied.length > 0) target.denyTools[body.server] = [...sourceDenied];
          else delete target.denyTools[body.server];
          applied.push(targetName);
        }
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig), applied, skipped });
        return;
      }

      if (profileMatch && method === "PUT") {
        const name = decodeURIComponent(profileMatch[1]!);
        const body = (await readJson(req)) as ProfileConfig;
        const next = structuredClone(this.rawConfig);
        const existing = next.profiles[name];
        next.profiles[name] = existing?.denyTools && body.denyTools === undefined
          ? { ...body, denyTools: existing.denyTools }
          : body;
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      if (profileMatch && method === "DELETE") {
        const name = decodeURIComponent(profileMatch[1]!);
        if (name === "default") {
          json(res, 400, { error: 'The "default" profile cannot be deleted' });
          return;
        }
        const next = structuredClone(this.rawConfig);
        if (!(name in next.profiles)) {
          json(res, 404, { error: `Unknown profile "${name}"` });
          return;
        }
        const usedBy = Object.entries(next.tokens)
          .filter(([, token]) =>
            (token.profiles ?? (token.profile ? [token.profile] : [])).includes(name),
          )
          .map(([tokenName]) => tokenName);
        if (usedBy.length > 0) {
          json(res, 409, {
            error: `Profile "${name}" is assigned to Token${usedBy.length === 1 ? "" : "s"}: ${usedBy.join(", ")}`,
          });
          return;
        }
        delete next.profiles[name];
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      if (tokenMatch && method === "PUT") {
        const name = decodeURIComponent(tokenMatch[1]!);
        const body = (await readJson(req)) as TokenConfig;
        const next = structuredClone(this.rawConfig);
        const { profile, ...canonical } = body;
        next.tokens[name] = {
          ...canonical,
          profiles: body.profiles ?? (profile ? [profile] : []),
        };
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      if (tokenMatch && method === "DELETE") {
        const name = decodeURIComponent(tokenMatch[1]!);
        if (name === "default") {
          json(res, 400, { error: 'The "default" token cannot be deleted' });
          return;
        }
        const next = structuredClone(this.rawConfig);
        if (!(name in next.tokens)) {
          json(res, 404, { error: `Unknown token "${name}"` });
          return;
        }
        delete next.tokens[name];
        await this.saveIncomingConfig(next);
        json(res, 200, { config: redactConfig(this.rawConfig) });
        return;
      }

      json(res, 404, { error: "Not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const status =
        err instanceof RequestBodyTooLargeError
          ? 413
          : message.startsWith("Validation failed") ||
        message.startsWith("Invalid variable name") ||
        message.includes("only available on macOS")
          ? 400
          : 500;
      json(res, status, { error: message });
    }
  }

  private variablePayload(): VariablesPayload {
    const store = this.activeVariableStore();
    const usages = collectSecretUsages(this.rawConfig);
    const stored = store.list();
    const storedByName = new Map(stored.map((variable) => [variable.name, variable]));
    const names = new Set([...storedByName.keys(), ...Object.keys(usages)]);
    const variables = [...names].sort().map((name) => {
      const variable = storedByName.get(name);
      return {
        name,
        type: variable?.type ?? "secret" as const,
        set: variable?.set ?? false,
        ...(variable?.type === "plain" ? { value: variable.value } : {}),
        usages: usages[name] ?? [],
      };
    });
    return {
      secretBackend: this.rawConfig.secretBackend.backend,
      ...(this.rawConfig.secretBackend.backend === "file"
        ? { secretPath: this.secretStoreOptions.filePath ?? DEFAULT_SECRETS_PATH }
        : {}),
      variablesPath: this.variableStoreOptions.variablesFilePath ?? DEFAULT_VARIABLES_PATH,
      keychainService: this.rawConfig.secretBackend.keychainService,
      keychainSupported: process.platform === "darwin",
      secretCount: variables.filter((variable) => variable.type === "secret" && variable.set).length,
      plainCount: variables.filter((variable) => variable.type === "plain" && variable.set).length,
      variables,
    };
  }

  private async reapplyRawConfig(): Promise<void> {
    if (!this.onSaveConfig) throw new Error("Config writes are not enabled");
    const runtime = await this.onSaveConfig(this.rawConfig);
    if (runtime) this.config = runtime;
  }

  private activeSecretStore(): SecretStore {
    return createSecretStore(this.rawConfig.secretBackend, this.secretStoreOptions);
  }

  private activeVariableStore(): VariableStore {
    return new VariableStore(this.activeSecretStore(), this.variableStoreOptions);
  }

  private async saveIncomingConfig(raw: unknown): Promise<void> {
    if (!this.onSaveConfig) {
      throw new Error("Config writes are not enabled");
    }

    const draft =
      raw && typeof raw === "object" && "config" in (raw as object)
        ? (raw as { config: unknown }).config
        : raw;

    const candidate = mergeSecrets(draft as OmniMcpConfig, this.rawConfig);
    const preliminary = validateConfig(candidate);
    const hasReferences = Object.keys(collectSecretUsages(candidate)).length > 0;
    if (!preliminary.config && !hasReferences) {
      throw new Error(`Validation failed: ${preliminary.errors.map((e) => e.message).join("; ")}`);
    }
    const persisted = preliminary.config ?? candidate;
    const runtime = await this.onSaveConfig(persisted);
    this.rawConfig = persisted;
    if (runtime) {
      this.config = runtime;
    } else {
      if (!preliminary.config) {
        throw new Error("Validation failed: secret references require a resolving config callback");
      }
      this.config = preliminary.config;
    }
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
    const blocked = this.serverIssues[name];
    if (blocked) {
      return { status: 409, error: `Server "${name}" was not started: ${blocked.join("; ")}` };
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

  private cliToolTarget(name: string):
    | { adapter: ServerAdapter; config: ServerConfig }
    | { status: number; error: string } {
    const config = this.config.servers[name];
    if (!config) {
      return { status: 404, error: `Unknown server "${name}"` };
    }
    if (config.cli?.enabled !== true) {
      return { status: 403, error: `Server "${name}" is not enabled for CLI access` };
    }
    return this.directToolTarget(name);
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
    let body: string;
    try {
      body = await readBody(req);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        json(res, 413, { error: error.message });
        return;
      }
      throw error;
    }
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
    profileConfig: ProfileConfig,
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
            serverInfo: { name: "omni-mcp", version: this.version },
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
    profileConfig: ProfileConfig,
  ): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }> {
    const allServerNames = Array.from(this.adapters.keys());
    const allowedServers = getAllowedServers(profileConfig, allServerNames);
    const tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];

    for (const serverName of allowedServers) {
      const adapter = this.adapters.get(serverName);
      if (!adapter || adapter.status !== "connected") continue;

      const serverTools = await adapter.listTools();
      for (const tool of serverTools) {
        if (
          this.isGloballyDisabled(serverName, tool.name) ||
          !isToolAllowed(serverName, tool.name, profileConfig)
        ) {
          continue;
        }
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
    profileConfig: ProfileConfig,
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
      source: "mcp",
      token: tokenName,
      profile: profileName,
      server: serverName,
      tool: toolName,
      namespacedTool,
      durationMs: Date.now() - startedAt,
      outcome: response.error === undefined ? "ok" : "error",
      ...(errorCode === undefined ? {} : { errorCode }),
    };
    await this.trafficLog.append(event).catch((error) => this.warnTrafficLogFailure(error));
    return response;
  }

  private async appendTrafficEvent(
    event: Omit<TrafficLogEvent, "ts">,
  ): Promise<void> {
    await this.trafficLog.append({
      ts: new Date().toISOString(),
      ...event,
    }).catch((error) => this.warnTrafficLogFailure(error));
  }

  private warnTrafficLogFailure(error: unknown): void {
    this.logger.warn(
      `Failed to write traffic log: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  private async executeToolCall(
    params: { name: string; arguments?: Record<string, unknown> },
    profileConfig: ProfileConfig,
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
    if (!adapter && this.serverIssues[serverName]) {
      return {
        error: {
          code: -32603,
          message: `Server '${serverName}' was not started: ${this.serverIssues[serverName]!.join("; ")}`,
        },
      };
    }
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
    if (
      this.isGloballyDisabled(serverName, toolName) ||
      !isToolAllowed(serverName, toolName, profileConfig)
    ) {
      return {
        error: { code: -32601, message: `Unknown tool: "${params.name}"` },
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
      return { result: this.presentResult(serverName, result) };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        error: { code: -32603, message: `Tool call failed: ${message}` },
      };
    }
  }

  /** Applies the server's TOON setting so every surface returns the same output. */
  private presentResult(serverName: string, result: ToolResult): ToolResult {
    return this.config.servers[serverName]?.toon?.enabled ? toonifyResult(result) : result;
  }

  private isGloballyDisabled(serverName: string, toolName: string): boolean {
    return (this.config.servers[serverName]?.disabledTools ?? []).includes(toolName);
  }
}

interface InlineSecretCandidate {
  name: string;
  server: string;
  field: "env" | "auth";
  envKey?: string;
  value: string;
}

function inlineSecretCandidates(config: OmniMcpConfig): InlineSecretCandidate[] {
  const candidates: InlineSecretCandidate[] = [];
  for (const [serverName, server] of Object.entries(config.servers)) {
    if (server.type === "stdio") {
      for (const [envKey, value] of Object.entries(server.env ?? {})) {
        if (!secretReferenceName(value) && value !== "********") {
          candidates.push({
            name: normalizeSecretName(envKey, `${serverName}_${envKey}`),
            server: serverName,
            field: "env",
            envKey,
            value,
          });
        }
      }
    } else if (server.auth?.token && !secretReferenceName(server.auth.token) && server.auth.token !== "********") {
      candidates.push({
        name: normalizeSecretName(`${serverName}_TOKEN`, "SERVER_TOKEN"),
        server: serverName,
        field: "auth",
        value: server.auth.token,
      });
    }
  }
  return candidates;
}

function normalizeSecretName(value: string, fallback: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const candidate = /^[A-Z_]/.test(normalized) ? normalized : `_${normalized}`;
  return candidate || fallback;
}

function withoutSecretValue(candidate: InlineSecretCandidate): Omit<InlineSecretCandidate, "value"> {
  const { value: _value, ...safe } = candidate;
  return safe;
}

function migrationConflicts(
  candidates: InlineSecretCandidate[],
  store?: Pick<VariableStore, "get" | "getType">,
): string[] {
  const values = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const candidate of candidates) {
    const previous = values.get(candidate.name);
    if (previous !== undefined && previous !== candidate.value) conflicts.add(candidate.name);
    const stored = store?.get(candidate.name);
    if (
      store?.getType(candidate.name) === "plain" ||
      (stored !== undefined && stored !== candidate.value)
    ) {
      conflicts.add(candidate.name);
    }
    values.set(candidate.name, candidate.value);
  }
  return [...conflicts].sort();
}

function applyInlineReference(config: OmniMcpConfig, candidate: InlineSecretCandidate): void {
  const server = config.servers[candidate.server];
  if (!server) return;
  if (candidate.field === "env" && server.type === "stdio" && candidate.envKey) {
    server.env ??= {};
    server.env[candidate.envKey] = `$${candidate.name}`;
  } else if (candidate.field === "auth" && server.type === "http" && server.auth) {
    server.auth.token = `$${candidate.name}`;
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
  if (!["tool", "server", "source", "token", "profile"].includes(rawGroupBy)) {
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
    ...sourceFilter(params),
    ...optionalFilter(params, "token"),
    ...optionalFilter(params, "profile"),
    ...optionalFilter(params, "server"),
    ...optionalFilter(params, "tool"),
  };
}

function sourceFilter(
  params: URLSearchParams,
): Pick<TrafficLogFilters, "source"> | Record<string, never> {
  const value = params.get("source");
  if (value === null || value === "") return {};
  if (value !== "mcp" && value !== "cli") {
    throw new Error("Validation failed: invalid source");
  }
  return { source: value };
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
    addr.startsWith("127.") ||
    addr === "::1" ||
    addr.startsWith("::ffff:127.")
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
    let size = 0;
    let settled = false;

    const contentLength = Number(req.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      req.resume();
      reject(new RequestBodyTooLargeError());
      return;
    }

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        settled = true;
        cleanup();
        req.resume();
        reject(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size).toString());
    };
    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds the ${MAX_REQUEST_BODY_BYTES}-byte limit`);
    this.name = "RequestBodyTooLargeError";
  }
}
