import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import type { StdioServerConfig } from "../config/index.js";
import type { ServerAdapter, ServerStatus, Tool, ToolResult } from "./types.js";
import { Logger } from "../logger.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class StdioAdapter implements ServerAdapter {
  readonly name: string;
  private config: StdioServerConfig;
  private process: ChildProcess | null = null;
  private tools: Tool[] = [];
  private _status: ServerStatus = "connecting";
  private _restarts = 0;
  private requestId = 0;
  private pending = new Map<number | string, PendingRequest>();
  private consecutiveHangs = 0;
  private lastSuccessTime = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private logger: Logger;
  private env: Record<string, string>;

  get status(): ServerStatus {
    return this._status;
  }

  get restarts(): number {
    return this._restarts;
  }

  constructor(name: string, config: StdioServerConfig, env: Record<string, string> = {}) {
    this.name = name;
    this.config = config;
    this.logger = new Logger(name);
    this.env = env;
  }

  async connect(): Promise<void> {
    this._status = "connecting";
    await this.spawnProcess();
    await this.initialize();
    this._status = "connected";
    this.lastSuccessTime = Date.now();
    this.consecutiveHangs = 0;
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

    try {
      const result = await this.sendRequest("tools/call", { name, arguments: args });
      this.consecutiveHangs = 0;
      this.resetRestartCounterIfStable();
      return result as ToolResult;
    } catch (err) {
      if (err instanceof Error && err.message.includes("timed out")) {
        this.consecutiveHangs++;
        this.logger.warn(`Tool call '${name}' timed out after ${this.config.callTimeoutMs}ms`);

        if (this.consecutiveHangs >= this.config.hangThreshold) {
          this.logger.error(
            `Hang threshold reached (${this.config.hangThreshold}). Killing and restarting.`,
          );
          await this.killAndRestart();
        }
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.process) {
      await this.killProcess();
    }
    this._status = "disabled";
  }

  private async spawnProcess(): Promise<void> {
    // Filter out unresolved $VAR tokens so the child inherits real values from process.env
    const isResolved = (v: string) => !v.startsWith("$");
    const configEnv = Object.fromEntries(
      Object.entries(this.config.env ?? {}).filter(([, v]) => isResolved(v))
    );
    const processEnv = {
      ...process.env,
      ...configEnv,
    };

    this.process = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.config.cwd,
      env: processEnv,
    });

    // Handle stderr
    if (this.process.stderr) {
      const rl = createInterface({ input: this.process.stderr });
      rl.on("line", (line) => {
        this.logger.debug(`[stderr] ${line}`);
      });
    }

    // Handle stdout (JSON-RPC responses)
    if (this.process.stdout) {
      const rl = createInterface({ input: this.process.stdout });
      rl.on("line", (line) => {
        this.handleLine(line);
      });
    }

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      if (this._status === "disabled") return; // Intentional shutdown
      this.logger.warn(`Process exited with code ${code} (signal: ${signal})`);
      this.handleCrash();
    });

    this.process.on("error", (err) => {
      this.logger.error(`Process error: ${err.message}`);
      this._status = "error";
    });
  }

  private async initialize(): Promise<void> {
    const result = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "omni-mcp", version: "0.1.0" },
    });

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});

    // Fetch every page before publishing the cached catalog.
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const toolsResult = (await this.sendRequest(
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
  }

  private sendRequest(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const message = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${this.config.callTimeoutMs}ms`));
      }, this.config.callTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.writeToProcess(message);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
    });
    this.writeToProcess(message);
  }

  private writeToProcess(message: string): void {
    if (!this.process?.stdin?.writable) {
      throw new Error(`Cannot write to process stdin for server "${this.name}"`);
    }
    this.process.stdin.write(message + "\n");
  }

  private handleLine(line: string): void {
    try {
      const message = JSON.parse(line) as {
        id?: number | string;
        result?: unknown;
        error?: { code: number; message: string; data?: unknown };
      };

      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(message.id);

          if (message.error) {
            pending.reject(
              new Error(`MCP Error ${message.error.code}: ${message.error.message}`),
            );
          } else {
            pending.resolve(message.result);
          }
        }
      }
    } catch {
      // Ignore non-JSON lines (debug output from some servers)
    }
  }

  private handleCrash(): void {
    this._status = "error";
    this.rejectAllPending(new Error(`Server "${this.name}" crashed`));

    if (this.config.maxRestarts === 0) {
      this.logger.error("Restarts disabled (maxRestarts=0). Server is down.");
      return;
    }

    if (this._restarts >= this.config.maxRestarts) {
      this.logger.error(
        `Max restarts (${this.config.maxRestarts}) reached. Server is down.`,
      );
      return;
    }

    const backoff = this.config.restartBackoffMs * Math.pow(2, this._restarts);
    this.logger.warn(
      `Restarting in ${backoff}ms (attempt ${this._restarts + 1}/${this.config.maxRestarts})...`,
    );

    this.restartTimer = setTimeout(async () => {
      this._restarts++;
      try {
        await this.connect();
        this.logger.info("Restarted successfully");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        this.logger.error(`Restart failed: ${message}`);
        this.handleCrash();
      }
    }, backoff);
  }

  private async killAndRestart(): Promise<void> {
    this.consecutiveHangs = 0;
    await this.killProcess();
    this.handleCrash();
  }

  private async killProcess(): Promise<void> {
    if (!this.process) return;

    const proc = this.process;
    this.process = null;
    this.rejectAllPending(new Error(`Server "${this.name}" is shutting down`));

    // Try graceful shutdown first
    proc.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private resetRestartCounterIfStable(): void {
    if (this._restarts > 0 && Date.now() - this.lastSuccessTime > 60000) {
      this._restarts = 0;
      this.lastSuccessTime = Date.now();
    }
  }
}
