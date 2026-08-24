import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readRuntimeMetadata } from "./pid.js";

export interface GatewayHealth {
  status: string;
  version: string;
  uptime: number;
  host: string;
  port: number;
  configPath?: string;
  defaultProfile: string;
  servers: Record<string, {
    enabled: boolean;
    cliEnabled: boolean;
    status: string;
    transport: string;
    restarts: number;
  }>;
}

export class GatewayClient {
  constructor(readonly baseUrl: string) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch {
      throw new Error(`Cannot reach the omni-mcp gateway at ${this.baseUrl}.`);
    }
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? `Gateway returned HTTP ${response.status}`);
    return body as T;
  }

  health(): Promise<GatewayHealth> {
    return this.request("/api/health");
  }
}

export function gatewayUrlFromConfig(configPath: string): string {
  const runtime = readRuntimeMetadata();
  if (runtime && resolve(runtime.configPath) === resolve(configPath)) {
    return `http://127.0.0.1:${runtime.port}`;
  }
  let port = 6317;
  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, "utf8")) as { port?: unknown };
      if (typeof raw.port === "number" && Number.isInteger(raw.port)) port = raw.port;
    } catch {
      // Config validation reports malformed files. The default remains useful for discovery.
    }
  }
  return `http://127.0.0.1:${port}`;
}

export async function matchingGateway(
  configPath: string,
  gatewayUrl?: string,
): Promise<{ client: GatewayClient; health: GatewayHealth } | undefined> {
  const client = new GatewayClient(gatewayUrl ?? gatewayUrlFromConfig(configPath));
  try {
    const health = await client.health();
    if (!health.configPath || resolve(health.configPath) !== resolve(configPath)) {
      process.stderr.write(
        `[omni-mcp] Running gateway uses ${health.configPath ?? "an unknown config path"}; using ${resolve(configPath)} offline.\n`,
      );
      return undefined;
    }
    return { client, health };
  } catch {
    return undefined;
  }
}
