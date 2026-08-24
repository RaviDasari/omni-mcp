import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerConfig } from "../../config/index.js";
import { readJsonConfig, validateAndWriteConfig } from "../config-edit.js";
import { matchingGateway } from "../http-client.js";

export interface AddOptions {
  type: string;
  command?: string;
  args?: string[];
  npx?: string;
  url?: string;
  profile?: string[];
  config: string;
  gatewayUrl?: string;
  json?: boolean;
}

export async function addCommand(
  serverName: string,
  options: AddOptions,
): Promise<void> {
  const configPath = resolve(options.config);

  // Load existing config or create new
  let config: Record<string, unknown>;
  if (existsSync(configPath)) {
    config = readJsonConfig(configPath);
  } else {
    config = {
      port: 6317,
      servers: {},
      profiles: { default: { allow: ["*"] } },
      tokens: { default: { profile: "default" } },
    };
  }

  const servers = (config.servers ?? {}) as Record<string, unknown>;

  if (serverName in servers) {
    process.stderr.write(`[omni-mcp] Server "${serverName}" already exists in config.\n`);
    process.exit(1);
  }

  // Build server entry
  let serverEntry: Record<string, unknown>;

  if (options.npx) {
    // --npx shorthand
    const parts = options.npx.split(" ");
    const pkg = parts[0];
    const extraArgs = parts.slice(1);
    serverEntry = {
      type: "stdio",
      command: "npx",
      args: ["-y", pkg, ...extraArgs],
    };
  } else if (options.type === "http") {
    if (!options.url) {
      process.stderr.write("[omni-mcp] --url is required for http servers.\n");
      process.exit(1);
    }
    serverEntry = {
      type: "http",
      url: options.url,
    };
  } else {
    if (!options.command) {
      process.stderr.write("[omni-mcp] --command is required for stdio servers.\n");
      process.exit(1);
    }
    serverEntry = {
      type: "stdio",
      command: options.command,
      args: options.args ?? [],
    };
  }

  const live = await matchingGateway(configPath, options.gatewayUrl);
  if (live) {
    const result = await live.client.request(`/api/servers/${encodeURIComponent(serverName)}`, {
      method: "PUT",
      body: JSON.stringify(serverEntry),
    });
    if (options.profile?.length) {
      const current = await live.client.request<{ config: {
        profiles: Record<string, { allow: string[] }>;
      } }>("/api/config");
      for (const profileName of options.profile) {
        const profile = current.config.profiles[profileName] ?? { allow: [] };
        if (!profile.allow.includes("*") && !profile.allow.includes(serverName)) {
          profile.allow.push(serverName);
        }
        await live.client.request(`/api/profiles/${encodeURIComponent(profileName)}`, {
          method: "PUT",
          body: JSON.stringify(profile),
        });
      }
    }
    if (options.json) process.stdout.write(`${JSON.stringify({ mode: "live", result })}\n`);
    else process.stdout.write(`[omni-mcp] Added server "${serverName}" (${serverEntry.type}) through the running gateway.\n`);
    return;
  }

  servers[serverName] = serverEntry as ServerConfig;
  config.servers = servers;

  // Add to profile allow lists
  if (options.profile && options.profile.length > 0) {
    const profiles = (config.profiles ?? {}) as Record<string, { allow: string[] }>;
    for (const profileName of options.profile) {
      if (!(profileName in profiles)) {
        profiles[profileName] = { allow: [] };
      }
      const allow = profiles[profileName].allow;
      if (!allow.includes("*") && !allow.includes(serverName)) {
        allow.push(serverName);
      }
    }
    config.profiles = profiles;
  }

  validateAndWriteConfig(configPath, config);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ mode: "offline", server: serverName, configPath })}\n`);
    return;
  }
  process.stdout.write(
    `[omni-mcp] Added server "${serverName}" (${serverEntry.type}) to ${configPath}\n`,
  );
  if (options.profile && options.profile.length > 0) {
    for (const p of options.profile) {
      process.stdout.write(`[omni-mcp] Added "${serverName}" to profile "${p}" allow list.\n`);
    }
  }
  process.stdout.write(
    `[omni-mcp] Tip: Run \`omni-mcp reload\` to pick up the change in a running instance.\n`,
  );
}
