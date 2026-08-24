import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  redactConfig,
  type OmniMcpConfig,
  type ProfileConfig,
  type ServerConfig,
  type TokenConfig,
} from "../../config/index.js";
import { DEFAULT_CONFIG_PATH } from "../config-path.js";
import { readJsonConfig, readRawConfig, validateAndWriteConfig } from "../config-edit.js";
import { GatewayClient, matchingGateway } from "../http-client.js";

interface CommonOptions {
  config: string;
  gatewayUrl?: string;
  json?: boolean;
  yes?: boolean;
}

interface JsonInputOptions {
  definition?: string;
  file?: string;
  stdin?: boolean;
}

type RawConfig = Record<string, unknown> & {
  servers?: Record<string, ServerConfig>;
  profiles?: Record<string, ProfileConfig>;
  tokens?: Record<string, TokenConfig>;
};

export function registerManagementCommands(program: Command): void {
  registerServerCommands(program);
  registerProfileCommands(program);
  registerTokenCommands(program);
  registerConfigCommands(program);
  registerLogsCommands(program);
  registerToolsCommands(program);
}

function common(command: Command, json = true): Command {
  command
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--gateway-url <url>", "Override gateway URL");
  if (json) command.option("--json", "Output machine-readable JSON");
  return command;
}

function registerServerCommands(program: Command): void {
  const server = program.command("server").description("Manage MCP servers");
  common(server.command("list")).action(safe(async (options: CommonOptions) => {
    const config = await getConfig(options);
    output(Object.entries(config.servers).map(([name, value]) => ({ name, ...value })), options);
  }));
  common(server.command("show <name>").alias("get")).action(safe(async (name: string, options: CommonOptions) => {
    const value = (await getConfig(options)).servers[name];
    if (!value) throw new Error(`Unknown server "${name}"`);
    output({ name, ...value }, options);
  }));
  common(server.command("add <name>").aliases(["set", "update"])
    .option("--definition <json>", "Server definition JSON")
    .option("--file <path>", "Read server definition JSON from file")
    .option("--stdin", "Read server definition JSON from stdin"))
    .action(safe((name: string, options: CommonOptions & JsonInputOptions) => {
      const definition = structuredInput(options, "server definition");
      return mutateConfig(options, `/api/servers/${encodeURIComponent(name)}`, "PUT", definition, (raw) => {
        raw.servers ??= {};
        raw.servers[name] = definition as ServerConfig;
      });
    }));
  common(server.command("clone <source> <name>")).action(safe(async (source: string, name: string, options: CommonOptions) => {
    const config = await getConfig(options);
    const value = config.servers[source];
    if (!value) throw new Error(`Unknown server "${source}"`);
    await mutateConfig(options, `/api/servers/${encodeURIComponent(name)}`, "PUT", value, (raw) => {
      raw.servers ??= {};
      if (raw.servers[name]) throw new Error(`Server "${name}" already exists`);
      raw.servers[name] = structuredClone(value);
    });
  }));
  common(server.command("remove <name>").alias("delete").option("--yes", "Skip confirmation")).action(safe(async (name: string, options: CommonOptions) => {
    await confirmDestructive(`Remove server "${name}"?`, options);
    return mutateConfig(options, `/api/servers/${encodeURIComponent(name)}`, "DELETE", undefined, (raw) => {
      if (!raw.servers?.[name]) throw new Error(`Unknown server "${name}"`);
      delete raw.servers[name];
      for (const profile of Object.values(raw.profiles ?? {})) {
        profile.allow = profile.allow.filter((entry) => entry !== name);
      }
    });
  }));
  for (const [commandName, field, enabled] of [
    ["enable", "enabled", true],
    ["disable", "enabled", false],
    ["cli-enable", "cli-enabled", true],
    ["cli-disable", "cli-enabled", false],
  ] as const) {
    common(server.command(`${commandName} <name>`)).action(safe((name: string, options: CommonOptions) =>
      mutateConfig(options, `/api/servers/${encodeURIComponent(name)}/${field}`, "PUT", { enabled }, (raw) => {
        const target = raw.servers?.[name];
        if (!target) throw new Error(`Unknown server "${name}"`);
        if (field === "enabled") target.enabled = enabled;
        else target.cli = { enabled };
      })));
  }
}

function registerProfileCommands(program: Command): void {
  const profile = program.command("profile").description("Manage tool-access profiles");
  common(profile.command("list")).action(safe(async (options: CommonOptions) => {
    const profiles = (await getConfig(options)).profiles;
    output(Object.entries(profiles).map(([name, value]) => ({ name, ...value })), options);
  }));
  common(profile.command("show <name>").alias("get")).action(safe(async (name: string, options: CommonOptions) => {
    const value = (await getConfig(options)).profiles[name];
    if (!value) throw new Error(`Unknown profile "${name}"`);
    output({ name, ...value }, options);
  }));
  common(profile.command("set <name>").aliases(["add", "create", "update"]).requiredOption("--allow <server...>", "Allowed servers or *"))
    .action(safe((name: string, options: CommonOptions & { allow: string[] }) =>
      mutateConfig(options, `/api/profiles/${encodeURIComponent(name)}`, "PUT", { allow: options.allow }, (raw) => {
        raw.profiles ??= {};
        raw.profiles[name] = { allow: options.allow };
      })));
  common(profile.command("remove <name>").alias("delete").option("--yes", "Skip confirmation")).action(safe(async (name: string, options: CommonOptions) => {
    await confirmDestructive(`Delete profile "${name}"?`, options);
    return mutateConfig(options, `/api/profiles/${encodeURIComponent(name)}`, "DELETE", undefined, (raw) => {
      if (name === "default") throw new Error('The "default" profile cannot be removed');
      if (!raw.profiles?.[name]) throw new Error(`Unknown profile "${name}"`);
      delete raw.profiles[name];
    });
  }));
}

function registerTokenCommands(program: Command): void {
  const token = program.command("token").description("Manage token-to-profile mappings");
  common(token.command("list")).action(safe(async (options: CommonOptions) => {
    const tokens = (await getConfig(options)).tokens;
    output(Object.entries(tokens).map(([name, value]) => ({ name, ...value })), options);
  }));
  common(token.command("show <name>").alias("get")).action(safe(async (name: string, options: CommonOptions) => {
    const value = (await getConfig(options)).tokens[name];
    if (!value) throw new Error(`Unknown token "${name}"`);
    output({ name, ...value }, options);
  }));
  common(token.command("set <name>").aliases(["add", "create", "update"]).requiredOption("--profile <name>", "Profile binding")
    .option("--description <text>", "Description").option("--disabled", "Disable token"))
    .action(safe((name: string, options: CommonOptions & { profile: string; description?: string; disabled?: boolean }) => {
      const value = {
        profile: options.profile,
        ...(options.description ? { description: options.description } : {}),
        disabled: options.disabled ?? false,
      };
      return mutateConfig(options, `/api/tokens/${encodeURIComponent(name)}`, "PUT", value, (raw) => {
        raw.tokens ??= {};
        raw.tokens[name] = value;
      });
    }));
  common(token.command("remove <name>").alias("delete").option("--yes", "Skip confirmation")).action(safe(async (name: string, options: CommonOptions) => {
    await confirmDestructive(`Delete token "${name}"?`, options);
    return mutateConfig(options, `/api/tokens/${encodeURIComponent(name)}`, "DELETE", undefined, (raw) => {
      if (name === "default") throw new Error('The "default" token cannot be removed');
      if (!raw.tokens?.[name]) throw new Error(`Unknown token "${name}"`);
      delete raw.tokens[name];
    });
  }));
  for (const [commandName, disabled] of [["enable", false], ["disable", true]] as const) {
    common(token.command(`${commandName} <name>`)).action(safe(async (name: string, options: CommonOptions) => {
      const current = (await getConfig(options)).tokens[name];
      if (!current) throw new Error(`Unknown token "${name}"`);
      const value = { ...current, disabled };
      return mutateConfig(options, `/api/tokens/${encodeURIComponent(name)}`, "PUT", value, (raw) => {
        if (!raw.tokens?.[name]) throw new Error(`Unknown token "${name}"`);
        raw.tokens[name] = value;
      });
    }));
  }
}

function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Inspect or replace configuration");
  common(config.command("show").alias("get")).action(safe(async (options: CommonOptions) => {
    output(await getConfig(options), options);
  }));
  common(config.command("path")).action((options: CommonOptions) => {
    output({ path: resolve(options.config) }, options);
  });
  common(config.command("apply").alias("set").option("--definition <json>", "Config JSON")
    .option("--file <path>", "Read config JSON from file").option("--stdin", "Read config JSON from stdin")
    .option("--yes", "Skip confirmation"))
    .action(safe(async (options: CommonOptions & JsonInputOptions) => {
      await confirmDestructive("Replace the selected configuration?", options);
      const next = structuredInput(options, "config");
      const live = await matchingGateway(options.config, options.gatewayUrl);
      if (live) {
        const result = await live.client.request<{ config: OmniMcpConfig }>("/api/config", {
          method: "PUT", body: JSON.stringify(next),
        });
        output(result, options);
      } else {
        output({ mode: "offline", config: redactConfig(validateAndWriteConfig(options.config, next)) }, options);
      }
    }));
  common(config.command("validate")).action(safe(async (options: CommonOptions) => {
    const config = readRawConfig(options.config);
    output({ valid: true, configPath: resolve(options.config), counts: {
      servers: Object.keys(config.servers).length,
      profiles: Object.keys(config.profiles).length,
      tokens: Object.keys(config.tokens).length,
    } }, options);
  }));
  common(config.command("reload")).action(safe(async (options: CommonOptions) => {
    const client = await requireLive(options);
    output(await client.request("/api/reload", { method: "POST" }), options);
  }));
}

function registerLogsCommands(program: Command): void {
  const logs = program.command("logs").description("Inspect metadata-only traffic logs");
  common(logs.command("list")
    .option("--from <iso>", "Start timestamp").option("--to <iso>", "End timestamp")
    .option("--source <source>", "mcp or cli").option("--token <name>", "Token filter")
    .option("--profile <name>", "Profile filter").option("--server <name>", "Server filter")
    .option("--tool <name>", "Tool filter").option("--offset <n>", "Offset", "0")
    .option("--limit <n>", "Limit", "100"))
    .action(safe(async (options: CommonOptions & Record<string, string>) => {
      const client = await requireLive(options);
      output(await client.request(`/api/traffic-logs?${query(options, ["from", "to", "source", "token", "profile", "server", "tool", "offset", "limit"])}`), options);
    }));
  common(logs.command("summary")
    .option("--from <iso>", "Start timestamp").option("--to <iso>", "End timestamp")
    .option("--source <source>", "mcp or cli").option("--token <name>", "Token filter")
    .option("--profile <name>", "Profile filter").option("--server <name>", "Server filter")
    .option("--tool <name>", "Tool filter").option("--group-by <field>", "tool, server, source, token, or profile", "tool"))
    .action(safe(async (options: CommonOptions & Record<string, string>) => {
      const client = await requireLive(options);
      output(await client.request(`/api/traffic-logs/summary?${query(options, ["from", "to", "source", "token", "profile", "server", "tool", "groupBy"])}`), options);
    }));
  common(logs.command("clear").option("--yes", "Skip confirmation")).action(safe(async (options: CommonOptions) => {
    await confirmDestructive("Clear all traffic logs?", options);
    const client = await requireLive(options);
    output(await client.request("/api/traffic-logs", { method: "DELETE" }), options);
  }));
}

function registerToolsCommands(program: Command): void {
  const tools = program.command("tools").description("Direct playground access to configured servers");
  common(tools.command("list <server>")).action(safe(async (server: string, options: CommonOptions) => {
    const client = await requireLive(options);
    output(await client.request(`/api/servers/${encodeURIComponent(server)}/tools`), options);
  }));
  common(tools.command("show <server> <tool>")).action(safe(async (server: string, tool: string, options: CommonOptions) => {
    const client = await requireLive(options);
    const response = await client.request<{ tools: Array<{ name: string }> }>(
      `/api/servers/${encodeURIComponent(server)}/tools`,
    );
    const value = response.tools.find((item) => item.name === tool);
    if (!value) throw new Error(`Unknown tool "${tool}" on server "${server}"`);
    output(value, options);
  }));
  common(tools.command("call <server> <tool>")
    .option("--args-json <json>", "Tool arguments as a JSON object", "{}")
    .option("--stdin", "Read tool arguments from stdin"))
    .action(safe(async (server: string, tool: string, options: CommonOptions & { argsJson: string; stdin?: boolean }) => {
      const args = parseObject(options.stdin ? readFileSync(0, "utf8") : options.argsJson);
      const client = await requireLive(options);
      const response = await client.request<{ result?: { isError?: boolean } }>(
        `/api/servers/${encodeURIComponent(server)}/tools/call`,
        { method: "POST", body: JSON.stringify({ tool, arguments: args }) },
      );
      output(response, options);
      if (response.result?.isError) process.exitCode = 1;
    }));
}

async function getConfig(options: CommonOptions): Promise<OmniMcpConfig> {
  const live = await matchingGateway(options.config, options.gatewayUrl);
  if (live) return (await live.client.request<{ config: OmniMcpConfig }>("/api/config")).config;
  return redactConfig(readRawConfig(options.config));
}

async function mutateConfig(
  options: CommonOptions,
  endpoint: string,
  method: "PUT" | "DELETE",
  body: unknown,
  edit: (raw: RawConfig) => void,
): Promise<void> {
  const live = await matchingGateway(options.config, options.gatewayUrl);
  if (live) {
    const result = await live.client.request(endpoint, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (options.json) output({ mode: "live", result }, options);
    else process.stdout.write("[omni-mcp] Updated the matching running gateway.\n");
    return;
  }
  const raw = readJsonConfig(options.config) as RawConfig;
  edit(raw);
  const config = validateAndWriteConfig(options.config, raw);
  if (options.json) output({ mode: "offline", config: redactConfig(config) }, options);
  else {
    process.stdout.write(
      `[omni-mcp] Updated ${resolve(options.config)} offline. Any running process was not changed; reload or restart is required.\n`,
    );
  }
}

async function requireLive(options: CommonOptions): Promise<GatewayClient> {
  const live = await matchingGateway(options.config, options.gatewayUrl);
  if (!live) throw new Error(`No running gateway uses config ${resolve(options.config)}`);
  return live.client;
}

function output(value: unknown, options: { json?: boolean }): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (typeof value === "string") process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Expected valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object");
  return value as Record<string, unknown>;
}

function structuredInput(options: JsonInputOptions, label: string): Record<string, unknown> {
  const selected = [options.definition !== undefined, options.file !== undefined, options.stdin === true]
    .filter(Boolean).length;
  if (selected !== 1) {
    throw new Error(`Supply exactly one of --definition, --file, or --stdin for the ${label}`);
  }
  return parseObject(
    options.definition ??
      (options.file ? readFileSync(options.file, "utf8") : readFileSync(0, "utf8")),
  );
}

async function confirmDestructive(message: string, options: { yes?: boolean }): Promise<void> {
  if (options.yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Confirmation required; rerun with --yes");
  }
  process.stderr.write(`${message} [y/N] `);
  const answer = await new Promise<string>((resolveAnswer) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (chunk) => resolveAnswer(String(chunk).trim()));
  });
  if (!/^y(?:es)?$/i.test(answer)) throw new Error("Cancelled");
}

function query(options: Record<string, unknown>, names: string[]): string {
  const params = new URLSearchParams();
  for (const name of names) {
    const value = options[name];
    if (typeof value === "string" && value) params.set(name === "groupBy" ? "groupBy" : name, value);
  }
  return params.toString();
}

function safe<T extends unknown[]>(action: (...args: T) => void | Promise<void>) {
  return async (...args: T): Promise<void> => {
    try {
      await action(...args);
    } catch (error) {
      process.stderr.write(`[omni-mcp] ERROR: ${error instanceof Error ? error.message : "Command failed"}\n`);
      process.exitCode = 1;
    }
  };
}
