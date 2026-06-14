import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface RemoveOptions {
  config: string;
}

export async function removeCommand(
  serverName: string,
  options: RemoveOptions,
): Promise<void> {
  const configPath = resolve(options.config);

  if (!existsSync(configPath)) {
    process.stderr.write(`[omni-mcp] Config file not found: ${configPath}\n`);
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  const servers = (config.servers ?? {}) as Record<string, unknown>;

  if (!(serverName in servers)) {
    process.stderr.write(`[omni-mcp] Server "${serverName}" not found in config.\n`);
    process.exit(1);
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

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  process.stdout.write(`[omni-mcp] Removed server "${serverName}" from ${configPath}\n`);
}
