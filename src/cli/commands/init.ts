import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

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
  const template = TEMPLATES[templateName];

  if (!template) {
    process.stderr.write(
      `[omni-mcp] Unknown template: "${templateName}". Available: ${Object.keys(TEMPLATES).join(", ")}\n`,
    );
    process.exit(1);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(template, null, 2) + "\n");

  process.stdout.write(`\n🌐 omni-mcp — Quick Setup\n`);
  process.stdout.write(`─────────────────────────\n\n`);
  process.stdout.write(`✅ Config written to ${outputPath}\n`);
  process.stdout.write(`   Template: ${templateName}\n\n`);
  process.stdout.write(`🚀 Next steps:\n`);
  process.stdout.write(`   1. Start the proxy:  npx omni-mcp start\n`);
  process.stdout.write(`   2. Point your IDE to: http://127.0.0.1:6317/mcp\n`);
  process.stdout.write(`      (see: npx omni-mcp ide-snippets)\n\n`);
}
