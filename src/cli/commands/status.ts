import { readPidFile } from "../pid.js";
import { resolve } from "node:path";
import { VERSION } from "../../version.js";
import type { OmniMcpConfig } from "../../config/index.js";
import { GatewayClient, gatewayUrlFromConfig } from "../http-client.js";

interface StatusOptions {
  config: string;
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const pid = readPidFile();

  if (!pid) {
    process.stderr.write("[omni-mcp] No running instance found.\n");
    process.exit(1);
  }

  // Check if process is actually running
  try {
    process.kill(pid, 0);
  } catch {
    process.stderr.write("[omni-mcp] No running instance found (stale PID file).\n");
    process.exit(1);
  }

  // Query the health endpoint of the running instance
  try {
    const client = new GatewayClient(gatewayUrlFromConfig(options.config));
    const health = await client.health();
    if (!health.configPath || resolve(health.configPath) !== resolve(options.config)) {
      throw new Error(`Running instance uses ${health.configPath ?? "an unknown config path"}`);
    }
    const { config } = await client.request<{ config: OmniMcpConfig }>("/api/config");
    const servers = health.servers;
    const enrichedServers = Object.fromEntries(await Promise.all(
      Object.entries(servers).map(async ([name, info]) => {
        let toolCount = 0;
        if (info.status === "connected") {
          try {
            const value = await client.request<{ tools: unknown[] }>(
              `/api/servers/${encodeURIComponent(name)}/tools`,
            );
            toolCount = value.tools.length;
          } catch {
            // Status remains useful when one adapter cannot list tools.
          }
        }
        return [name, { ...info, toolCount }];
      }),
    )) as Record<string, typeof servers[string] & { toolCount: number }>;
    const payload = {
      version: health.version ?? VERSION,
      pid,
      uptime: health.uptime,
      address: `http://${health.host}:${health.port}`,
      configPath: resolve(options.config),
      defaultProfile: health.defaultProfile,
      tokens: config.tokens,
      servers: enrichedServers,
    };

    if (options.json) {
      process.stdout.write(JSON.stringify(payload) + "\n");
    } else {
      process.stdout.write(`omni-mcp  v${payload.version}  PID: ${pid}  Uptime: ${formatUptime(payload.uptime)}\n`);
      process.stdout.write(`Listening: ${payload.address}\n`);
      process.stdout.write(`Config: ${payload.configPath}\n`);
      process.stdout.write(`Default profile: ${payload.defaultProfile}\n\n`);

      process.stdout.write(`Tokens (${Object.keys(config.tokens).length}):\n`);
      for (const [name, token] of Object.entries(config.tokens)) {
        process.stdout.write(`  ${name}  →  ${token.profile}${token.disabled ? " (disabled)" : ""}\n`);
      }
      process.stdout.write("\n");

      if (enrichedServers) {
        process.stdout.write("Servers:\n");
        process.stdout.write("  NAME            TYPE   STATUS     RESTARTS  TOOLS\n");
        for (const [name, info] of Object.entries(enrichedServers)) {
          process.stdout.write(
            `  ${name.padEnd(15)} ${info.transport.padEnd(6)} ${info.status.padEnd(10)} ${String(info.restarts ?? "—").padEnd(9)} ${info.toolCount}\n`,
          );
        }
      }
    }
  } catch (error) {
    process.stderr.write(`[omni-mcp] Failed to reach matching running instance: ${error instanceof Error ? error.message : "unknown error"}.\n`);
    process.exit(1);
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
