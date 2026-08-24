import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";

interface InitOptions {
  import?: boolean;
  yes?: boolean;
  output: string;
  template?: string;
}

const TEMPLATES: Record<string, Record<string, unknown>> = {
  minimal: {
    port: 6317,
    servers: {
      filesystem: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      },
    },
    profiles: {
      default: { allow: ["*"] },
    },
    tokens: {
      default: { profile: "default" },
    },
  },
  "multi-agent": {
    port: 6317,
    servers: {
      filesystem: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      },
      github: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "$GITHUB_TOKEN" },
      },
      memory: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
      },
    },
    profiles: {
      default: { allow: ["filesystem", "memory"] },
      admin: { allow: ["*"] },
      safe: { allow: ["filesystem", "memory"] },
    },
    tokens: {
      default: { profile: "safe", description: "Unknown agents — restricted" },
      cursor: { profile: "admin", description: "Cursor IDE — full access" },
      claude: { profile: "safe", description: "Claude Desktop — safe tools" },
    },
  },
  team: {
    port: 6317,
    servers: {
      filesystem: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      },
      github: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_TOKEN: "$GITHUB_TOKEN" },
      },
      "prod-api": {
        type: "http",
        url: "https://api.example.com/mcp",
        auth: { type: "jwt", token: "$PROD_API_JWT" },
      },
    },
    profiles: {
      default: { allow: ["filesystem"] },
      developer: { allow: ["filesystem", "github"] },
      admin: { allow: ["*"] },
    },
    tokens: {
      default: { profile: "default", description: "Fallback" },
      cursor: { profile: "admin", description: "Cursor — full access" },
      claude: { profile: "developer", description: "Claude — dev tools" },
      "ci-bot": { profile: "developer", description: "CI agent" },
    },
    security: {
      unknownTokenPolicy: "reject",
    },
  },
};

export interface ImportedServer {
  name: string;
  source: string;
  config: Record<string, unknown>;
}

export function discoverMcpServers(options: {
  home?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
} = {}): ImportedServer[] {
  const home = options.home ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const candidates: Array<[string, string]> = [
    ["Cursor", join(home, ".cursor", "mcp.json")],
    ["VS Code", join(home, ".vscode", "mcp.json")],
    ["VS Code workspace", join(cwd, ".vscode", "mcp.json")],
  ];
  if (platform === "darwin") {
    candidates.push(["Claude Desktop", join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")]);
  } else if (platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) candidates.push(["Claude Desktop", join(appData, "Claude", "claude_desktop_config.json")]);
  } else {
    candidates.push(["Claude Desktop", join(home, ".config", "Claude", "claude_desktop_config.json")]);
  }

  const imported: ImportedServer[] = [];
  const used = new Set<string>();
  for (const [source, path] of candidates) {
    if (!existsSync(path)) continue;
    let document: unknown;
    try {
      document = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (!document || typeof document !== "object" || Array.isArray(document)) continue;
    const root = document as Record<string, unknown>;
    const collection = root.mcpServers ?? root.servers;
    if (!collection || typeof collection !== "object" || Array.isArray(collection)) continue;
    for (const [originalName, value] of Object.entries(collection as Record<string, unknown>)) {
      const normalized = normalizeImportedServer(value);
      if (!normalized || isOmniGateway(originalName, normalized)) continue;
      let name = originalName;
      let suffix = 2;
      while (used.has(name)) name = `${originalName}-${suffix++}`;
      used.add(name);
      imported.push({ name, source, config: normalized });
    }
  }
  return imported;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const outputPath = resolve(options.output);

  if (existsSync(outputPath) && !options.yes) {
    process.stderr.write(
      `[omni-mcp] Config already exists: ${outputPath}\n` +
        `  Use --yes to overwrite or specify a different --output path.\n`,
    );
    process.exit(1);
  }

  // Select template
  const templateName = options.template ?? "multi-agent";
  const selectedTemplate = TEMPLATES[templateName];

  if (!selectedTemplate) {
    process.stderr.write(
      `[omni-mcp] Unknown template: "${templateName}". Available: ${Object.keys(TEMPLATES).join(", ")}\n`,
    );
    process.exit(1);
  }
  const template = structuredClone(selectedTemplate);
  const imported = options.import ? discoverMcpServers() : [];
  if (options.import && imported.length > 0) {
    template.servers = Object.fromEntries(imported.map((item) => [item.name, item.config]));
    template.profiles = { default: { allow: ["*"] } };
    template.tokens = { default: { profile: "default" } };
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(template, null, 2) + "\n");

  process.stdout.write(`\n🌐 omni-mcp — Quick Setup\n`);
  process.stdout.write(`─────────────────────────\n\n`);
  process.stdout.write(`✅ Config written to ${outputPath}\n`);
  process.stdout.write(`   Template: ${templateName}\n\n`);
  if (options.import) {
    process.stdout.write(`   Imported: ${imported.length} server(s)${imported.length ? ` from ${[...new Set(imported.map((item) => item.source))].join(", ")}` : ""}\n\n`);
  }
  process.stdout.write(`🚀 Next steps:\n`);
  process.stdout.write(`   1. Start the proxy:  omni-mcp start\n`);
  process.stdout.write(`   2. Point your IDE to: http://127.0.0.1:6317/mcp\n`);
  process.stdout.write(`      (see: omni-mcp ide-snippets)\n\n`);
}

function normalizeImportedServer(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.command === "string" && input.command.length > 0) {
    return {
      type: "stdio",
      command: input.command,
      args: Array.isArray(input.args) ? input.args.filter((item): item is string => typeof item === "string") : [],
      ...(typeof input.cwd === "string" ? { cwd: input.cwd } : {}),
      ...(isStringRecord(input.env) ? { env: input.env } : {}),
    };
  }
  if (typeof input.url === "string") {
    return { type: "http", url: input.url };
  }
  return undefined;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

function isOmniGateway(name: string, config: Record<string, unknown>): boolean {
  return name === "omni-mcp" ||
    (typeof config.url === "string" && /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/mcp\/?$/.test(config.url));
}
