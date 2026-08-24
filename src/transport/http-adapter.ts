import type { HttpServerConfig } from "../config/index.js";
import type { ServerAdapter, ServerStatus, Tool, ToolResult } from "./types.js";
import { Logger } from "../logger.js";
import { VERSION } from "../version.js";

export class HttpAdapter implements ServerAdapter {
  readonly name: string;
  private config: HttpServerConfig;
  private tools: Tool[] = [];
  private _status: ServerStatus = "connecting";
  private _restarts = 0;
  private logger: Logger;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private authToken: string | undefined;

  get status(): ServerStatus {
    return this._status;
  }

  get restarts(): number {
    return this._restarts;
  }

  constructor(name: string, config: HttpServerConfig, authToken?: string) {
    this.name = name;
    this.config = config;
    this.logger = new Logger(name);
    this.authToken = authToken;
  }

  async connect(): Promise<void> {
    this._status = "connecting";

    try {
      // Send MCP initialize
      const initResult = await this.sendMcpRequest("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "omni-mcp", version: VERSION },
      });

      // Send initialized notification
      await this.sendMcpNotification("notifications/initialized", {});

      // Fetch every page before publishing the cached catalog.
      const tools: Tool[] = [];
      let cursor: string | undefined;
      do {
        const toolsResult = (await this.sendMcpRequest(
          "tools/list",
          cursor ? { cursor } : {},
        )) as {
          tools?: Tool[];
          nextCursor?: string;
        };
        tools.push(...(toolsResult.tools ?? []));
        cursor = toolsResult.nextCursor || undefined;
      } while (cursor);
      this.tools = tools;

      this._status = "connected";
      this.logger.info(`Connected. ${this.tools.length} tools available.`);
    } catch (err) {
      this._status = "error";
      const message = err instanceof Error ? err.message : "Unknown error";
      this.logger.error(`Connection failed: ${message}`);
      this.scheduleReconnect();
      throw err;
    }
  }

  async listTools(): Promise<Tool[]> {
    if (this._status !== "connected") {
      return [];
    }
    return [...this.tools];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (this._status !== "connected") {
      throw new Error(`Server "${this.name}" is unavailable (status: ${this._status})`);
    }

    const result = await this.sendMcpRequest("tools/call", {
      name,
      arguments: args,
    });
    return result as ToolResult;
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._status = "disabled";
  }

  private async sendMcpRequest(
    method: string,
    params: unknown,
  ): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    });

    const response = await this.fetchWithRetry(body);
    const result = (await response.json()) as {
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    };

    if (result.error) {
      throw new Error(
        `MCP Error ${result.error.code}: ${result.error.message}`,
      );
    }

    return result.result;
  }

  private async sendMcpNotification(
    method: string,
    params: unknown,
  ): Promise<void> {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });

    await this.fetchWithRetry(body);
  }

  private async fetchWithRetry(body: string): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (this.authToken) {
          headers["Authorization"] = "Bearer " + this.authToken;
        }

        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs,
        );

        const response = await fetch(this.config.url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (response.status === 401) {
          throw new Error("Unauthorized — upstream server rejected credentials");
        }

        if (response.status >= 500) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error("Unknown error");

        if (attempt < this.config.retries) {
          const backoff = this.config.retryBackoffMs * Math.pow(2, attempt);
          await sleep(backoff);
        }
      }
    }

    this._status = "error";
    this.scheduleReconnect();
    throw lastError ?? new Error("All retries exhausted");
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this._status === "disabled") return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this._restarts++;
      this.logger.info("Attempting reconnection...");
      try {
        await this.connect();
        this.logger.info("Reconnected successfully");
      } catch {
        // connect() already schedules another reconnect on failure
      }
    }, this.config.reconnectIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
