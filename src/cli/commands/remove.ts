import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readJsonConfig, validateAndWriteConfig } from "../config-edit.js";
import { matchingGateway } from "../http-client.js";

interface RemoveOptions {
  config: string;
  gatewayUrl?: string;
  json?: boolean;
  yes?: boolean;
}

export async function removeCommand(
  serverName: string,
  options: RemoveOptions,
): Promise<void> {
  const configPath = resolve(options.config);
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Confirmation required; rerun with --yes");
    }
    process.stderr.write(`Remove server "${serverName}"? [y/N] `);
    const answer = await new Promise<string>((resolveAnswer) => {
      process.stdin.setEncoding("utf8");
      process.stdin.once("data", (chunk) => resolveAnswer(String(chunk).trim()));
    });
    if (!/^y(?:es)?$/i.test(answer)) throw new Error("Cancelled");
  }

  if (!existsSync(configPath)) {
    process.stderr.write(`[omni-mcp] Config file not found: ${configPath}\n`);
    process.exit(1);
  }

  const config = readJsonConfig(configPath);
  const servers = (config.servers ?? {}) as Record<string, unknown>;

  if (!(serverName in servers)) {
    process.stderr.write(`[omni-mcp] Server "${serverName}" not found in config.\n`);
    process.exit(1);
  }

  const live = await matchingGateway(configPath, options.gatewayUrl);
  if (live) {
    const result = await live.client.request(`/api/servers/${encodeURIComponent(serverName)}`, {
      method: "DELETE",
    });
    if (options.json) process.stdout.write(`${JSON.stringify({ mode: "live", result })}\n`);
    else process.stdout.write(`[omni-mcp] Removed server "${serverName}" through the running gateway.\n`);
    return;
  }

  // Remove server
  delete servers[serverName];
  config.servers = servers;

  // Remove from all profile allow lists
  const profiles = (config.profiles ?? {}) as Record<string, { allow: string[] }>;
  for (const [profileName, profile] of Object.entries(profiles)) {
    const idx = profile.allow.indexOf(serverName);
    if (idx !== -1) {
      profile.allow.splice(idx, 1);
      process.stdout.write(
        `[omni-mcp] Removed "${serverName}" from profile "${profileName}" allow list.\n`,
      );
    }
  }
  config.profiles = profiles;

  validateAndWriteConfig(configPath, config);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ mode: "offline", server: serverName, configPath })}\n`);
    return;
  }
  process.stdout.write(`[omni-mcp] Removed server "${serverName}" from ${configPath}\n`);
}
