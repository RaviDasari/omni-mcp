import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface AddOptions {
  type: string;
  command?: string;
  args?: string[];
  npx?: string;
  url?: string;
  profile?: string[];
  config: string;
}

export async function addCommand(
  serverName: string,
  options: AddOptions,
): Promise<void> {
  const configPath = resolve(options.config);

  // Load existing config or create new
  let config: Record<string, unknown>;
  if (existsSync(configPath)) {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
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

  servers[serverName] = serverEntry;
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

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

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
