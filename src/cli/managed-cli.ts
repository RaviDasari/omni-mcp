import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG_PATH } from "./config-path.js";
import { runInstallSkill } from "./skill-installer.js";
import type { Tool, ToolResult } from "../transport/types.js";
import { GatewayClient, gatewayUrlFromConfig } from "./http-client.js";

export interface ParamDef {
  cliName: string;
  originalName: string;
  description?: string;
  required: boolean;
  schema: Record<string, unknown>;
}

export interface CommandDef {
  cliName: string;
  originalName: string;
  description?: string;
  params: ParamDef[];
}

export interface CliServer {
  name: string;
  transport: string;
  enabled: boolean;
  cliEnabled: boolean;
  status: string;
  toolCount: number;
}

interface ServerToolsResponse {
  server: string;
  tools: Tool[];
}

interface ToolCallResponse {
  server: string;
  tool: string;
  durationMs: number;
  result: ToolResult;
}

interface UsageEntry {
  count: number;
  lastUsed: string;
}

type UsageData = Record<string, UsageEntry>;

const BUILTIN_OPTIONS = new Set([
  "help",
  "list",
  "search",
  "compact",
  "top",
  "sort",
  "head",
  "json",
  "pretty",
  "stdin",
  "args-json",
  "gateway-url",
  "config",
]);

const DEFAULT_USAGE_PATH = join(homedir(), ".omni-mcp", "cli-usage.json");

export function toKebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "tool";
}

export function buildCommandDefs(tools: Tool[]): CommandDef[] {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const naturalNames = new Set(sorted.map((tool) => toKebab(tool.name)));
  const used = new Set<string>();

  return sorted.map((tool) => {
    const base = toKebab(tool.name);
    let cliName = base;
    let suffix = 2;
    while (used.has(cliName)) {
      do {
        cliName = `${base}-${suffix++}`;
      } while (used.has(cliName) || naturalNames.has(cliName));
    }
    used.add(cliName);

    const input = isRecord(tool.inputSchema) ? tool.inputSchema : {};
    const properties = isRecord(input.properties) ? input.properties : {};
    const required = new Set(
      Array.isArray(input.required)
        ? input.required.filter((value): value is string => typeof value === "string")
        : [],
    );
    const usedParams = new Set<string>();
    const params = Object.entries(properties)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([originalName, rawSchema]) => {
        const schema = isRecord(rawSchema) ? rawSchema : {};
        let paramName = toKebab(originalName);
        if (BUILTIN_OPTIONS.has(paramName)) paramName = `arg-${paramName}`;
        let candidate = paramName;
        let paramSuffix = 2;
        while (usedParams.has(candidate) || BUILTIN_OPTIONS.has(candidate)) {
          candidate = `${paramName}-${paramSuffix++}`;
        }
        usedParams.add(candidate);
        return {
          cliName: candidate,
          originalName,
          description: typeof schema.description === "string" ? schema.description : undefined,
          required: required.has(originalName),
          schema,
        };
      });

    return {
      cliName,
      originalName: tool.name,
      description: tool.description,
      params,
    };
  });
}

export function parseToolArguments(
  command: CommandDef,
  argv: string[],
  stdinValue?: string,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const values = new Map<string, string[]>();
  let jsonArgs: string | undefined;
  let useStdin = false;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === "--") continue;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument "${token}"`);
    }
    const [rawName, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    if (rawName === "stdin") {
      useStdin = true;
      continue;
    }
    if (rawName === "args-json") {
      jsonArgs = inlineValue ?? argv[++index];
      if (jsonArgs === undefined) throw new Error("--args-json requires a JSON object");
      continue;
    }
    const param = command.params.find((item) => item.cliName === rawName);
    if (!param) throw new Error(`Unknown option "--${rawName}"`);
    const type = schemaType(param.schema);
    let value = inlineValue;
    if (value === undefined && type !== "boolean") {
      value = argv[++index];
      if (value === undefined) throw new Error(`--${rawName} requires a value`);
    }
    const list = values.get(rawName) ?? [];
    list.push(value ?? "true");
    values.set(rawName, list);
  }

  if (jsonArgs !== undefined && useStdin) {
    throw new Error("Use either --args-json or --stdin, not both");
  }
  const base = jsonArgs ?? (useStdin ? stdinValue : undefined);
  if (base !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(base);
    } catch {
      throw new Error(`${useStdin ? "stdin" : "--args-json"} must contain valid JSON`);
    }
    if (!isRecord(parsed)) {
      throw new Error(`${useStdin ? "stdin" : "--args-json"} must contain a JSON object`);
    }
    Object.assign(args, parsed);
  }

  for (const param of command.params) {
    const rawValues = values.get(param.cliName);
    if (rawValues) {
      args[param.originalName] = coerceValues(rawValues, param.schema, param.cliName);
    }
    if (param.required && args[param.originalName] === undefined) {
      throw new Error(`Missing required option "--${param.cliName}"`);
    }
  }
  return args;
}

export async function runManagedCli(argv: string[]): Promise<number> {
  if (argv[0] === "install-skill") {
    return runInstallSkill(argv.slice(1));
  }
  try {
    const parsed = parseGlobalArgs(argv);
    const client = new GatewayClient(parsed.gatewayUrl ?? gatewayUrlFromConfig(parsed.config));
    const usage = readUsage();

    if (!parsed.server) {
      if (parsed.tool) throw new Error("A server name is required");
      if (parsed.help) {
        printCliHelp();
        return 0;
      }
      const response = await client.request<{ servers: CliServer[] }>("/api/cli/servers");
      printServerList(response.servers, parsed.json);
      return 0;
    }

    const response = await client.request<ServerToolsResponse>(
      `/api/cli/servers/${encodeURIComponent(parsed.server)}/tools`,
    );
    const commands = buildCommandDefs(response.tools);
    if (!parsed.tool) {
      printCommandList(parsed.server, commands, parsed, usage);
      return 0;
    }

    const command = commands.find(
      (item) => item.cliName === parsed.tool || item.originalName === parsed.tool,
    );
    if (!command) {
      throw new Error(
        `Unknown tool "${parsed.tool}" on server "${parsed.server}". Run "omni-mcp cli ${parsed.server} --list".`,
      );
    }
    if (parsed.help) {
      printToolHelp(parsed.server, command);
      return 0;
    }

    const stdinValue = parsed.toolArgs.includes("--stdin")
      ? await readStdin()
      : undefined;
    const toolArgs = parseToolArguments(command, parsed.toolArgs, stdinValue);
    const result = await client.request<ToolCallResponse>(
      `/api/cli/servers/${encodeURIComponent(parsed.server)}/tools/call`,
      {
        method: "POST",
        body: JSON.stringify({ tool: command.originalName, arguments: toolArgs }),
      },
    );
    recordUsage(parsed.server, command.originalName, usage);
    printToolResult(result.result, parsed);
    return result.result.isError ? 1 : 0;
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    return 1;
  }
}

interface ParsedCli {
  server?: string;
  tool?: string;
  toolArgs: string[];
  config: string;
  gatewayUrl?: string;
  list: boolean;
  search?: string;
  compact: boolean;
  top?: number;
  sort: "usage" | "recent" | "alpha" | "default";
  head?: number;
  json: boolean;
  pretty: boolean;
  help: boolean;
}

function parseGlobalArgs(argv: string[]): ParsedCli {
  const result: ParsedCli = {
    toolArgs: [],
    config: DEFAULT_CONFIG_PATH,
    list: false,
    compact: false,
    sort: "default",
    json: false,
    pretty: false,
    help: false,
  };
  const positional: string[] = [];
  let afterBoundary = false;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (afterBoundary) {
      result.toolArgs.push(token);
      continue;
    }
    if (token === "--") {
      afterBoundary = true;
      result.toolArgs.push(token);
      continue;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      if (positional.length > 2) result.toolArgs.push(token);
      continue;
    }

    const [name, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    const takeValue = (): string => {
      const value = inlineValue ?? argv[++index];
      if (value === undefined) throw new Error(`--${name} requires a value`);
      return value;
    };
    if (name === "config") result.config = takeValue();
    else if (name === "gateway-url") result.gatewayUrl = takeValue();
    else if (name === "list") result.list = true;
    else if (name === "search") result.search = takeValue();
    else if (name === "compact") result.compact = true;
    else if (name === "top") result.top = positiveInteger(takeValue(), "top");
    else if (name === "sort") {
      const value = takeValue();
      if (!["usage", "recent", "alpha", "default"].includes(value)) {
        throw new Error("--sort must be usage, recent, alpha, or default");
      }
      result.sort = value as ParsedCli["sort"];
    } else if (name === "head") result.head = positiveInteger(takeValue(), "head");
    else if (name === "json") result.json = true;
    else if (name === "pretty") result.pretty = true;
    else if (name === "help") result.help = true;
    else result.toolArgs.push(token);
  }
  result.server = positional[0];
  result.tool = positional[1];
  if (result.search) result.list = true;
  return result;
}

function printServerList(servers: CliServer[], jsonOutput: boolean): void {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(servers)}\n`);
    return;
  }
  if (servers.length === 0) {
    process.stdout.write("No servers are enabled for CLI access. Enable one in the CLI web tab.\n");
    return;
  }
  process.stdout.write("SERVER\tTYPE\tSTATUS\tTOOLS\n");
  for (const server of servers) {
    process.stdout.write(
      `${server.name}\t${server.transport}\t${server.status}\t${server.toolCount}\n`,
    );
  }
}

function printCliHelp(): void {
  process.stdout.write(
    "Usage: omni-mcp cli [server] [tool] [options]\n\n" +
    "  omni-mcp cli --list\n" +
    "  omni-mcp cli <server> --list [--search <text>] [--compact] [--top <n>]\n" +
    "  omni-mcp cli <server> <tool> --help\n" +
    "  omni-mcp cli <server> <tool> [schema-derived flags]\n\n" +
    "  omni-mcp cli install-skill [--target all] [--scope user]\n\n" +
    "Options:\n" +
    "  --gateway-url <url>  Override the running gateway URL\n" +
    "  --config <path>      Config used to discover the gateway port\n" +
    "  --json               Emit valid JSON\n" +
    "  --head <n>           Limit top-level array results\n",
  );
}

function printCommandList(
  server: string,
  commands: CommandDef[],
  options: ParsedCli,
  usage: UsageData,
): void {
  let filtered = options.search
    ? commands.filter((command) =>
        `${command.cliName} ${command.originalName} ${command.description ?? ""}`
          .toLowerCase()
          .includes(options.search!.toLowerCase()))
    : commands;
  filtered = sortCommands(server, filtered, options.sort, usage);
  if (options.top !== undefined) filtered = filtered.slice(0, options.top);

  if (options.json) {
    const value = options.compact
      ? filtered.map((command) => command.cliName)
      : filtered;
    process.stdout.write(`${JSON.stringify(value, null, options.pretty ? 2 : undefined)}\n`);
  } else if (options.compact) {
    process.stdout.write(`${filtered.map((command) => command.cliName).join(" ")}\n`);
  } else {
    for (const command of filtered) {
      process.stdout.write(
        `${command.cliName}${command.description ? `\t${command.description}` : ""}\n`,
      );
    }
  }
}

function printToolHelp(server: string, command: CommandDef): void {
  process.stdout.write(`Usage: omni-mcp cli ${server} ${command.cliName} [options]\n`);
  if (command.description) process.stdout.write(`\n${command.description}\n`);
  process.stdout.write("\nOptions:\n");
  for (const param of command.params) {
    const type = schemaType(param.schema);
    const required = param.required ? " (required)" : "";
    const choices = Array.isArray(param.schema.enum)
      ? ` [${param.schema.enum.join(", ")}]`
      : "";
    process.stdout.write(
      `  --${param.cliName}${type === "boolean" ? "" : ` <${type}>`}${required}${choices}` +
      `${param.description ? `\t${param.description}` : ""}\n`,
    );
  }
  process.stdout.write("  --args-json <json>\tSupply a complete JSON argument object\n");
  process.stdout.write("  --stdin\tRead a complete JSON argument object from stdin\n");
  process.stdout.write("  --json\tPrint the full MCP result as JSON\n");
}

function printToolResult(result: ToolResult, options: ParsedCli): void {
  const output = options.head === undefined ? result : truncateResult(result, options.head);
  if (options.json) {
    const pretty = options.pretty || process.stdout.isTTY;
    process.stdout.write(`${JSON.stringify(output, null, pretty ? 2 : undefined)}\n`);
    return;
  }
  const text = output.content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  if (text) {
    process.stdout.write(`${text}\n`);
    return;
  }
  if (output.structuredContent !== undefined) {
    process.stdout.write(`${JSON.stringify(output.structuredContent, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

function truncateResult(result: ToolResult, head: number): ToolResult {
  const copy = structuredClone(result);
  if (Array.isArray(copy.structuredContent)) {
    copy.structuredContent = copy.structuredContent.slice(0, head);
  }
  copy.content = copy.content.map((item) => {
    if (item.type !== "text" || typeof item.text !== "string") return item;
    try {
      const parsed = JSON.parse(item.text) as unknown;
      if (Array.isArray(parsed)) return { ...item, text: JSON.stringify(parsed.slice(0, head)) };
    } catch {
      // Keep non-JSON text unchanged.
    }
    return item;
  });
  return copy;
}

function sortCommands(
  server: string,
  commands: CommandDef[],
  mode: ParsedCli["sort"],
  usage: UsageData,
): CommandDef[] {
  if (mode === "default" && !commands.some((command) => usage[usageKey(server, command.originalName)])) {
    return commands;
  }
  const selected = mode === "default" ? "usage" : mode;
  if (selected === "alpha") return [...commands].sort((a, b) => a.cliName.localeCompare(b.cliName));
  if (selected === "recent") {
    return [...commands].sort((a, b) =>
      (usage[usageKey(server, b.originalName)]?.lastUsed ?? "")
        .localeCompare(usage[usageKey(server, a.originalName)]?.lastUsed ?? ""));
  }
  return [...commands].sort((a, b) =>
    (usage[usageKey(server, b.originalName)]?.count ?? 0) -
    (usage[usageKey(server, a.originalName)]?.count ?? 0));
}

function readUsage(path = usagePath()): UsageData {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isRecord(parsed) ? parsed as UsageData : {};
  } catch {
    return {};
  }
}

function recordUsage(server: string, tool: string, usage: UsageData): void {
  const key = usageKey(server, tool);
  usage[key] = {
    count: (usage[key]?.count ?? 0) + 1,
    lastUsed: new Date().toISOString(),
  };
  const path = usagePath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(usage, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function usageKey(server: string, tool: string): string {
  return `${server}__${tool}`;
}

function usagePath(): string {
  return process.env.OMNI_MCP_CLI_USAGE_FILE || DEFAULT_USAGE_PATH;
}

function coerceValues(
  values: string[],
  schema: Record<string, unknown>,
  cliName: string,
): unknown {
  const type = schemaType(schema);
  if (type === "array") {
    const itemSchema = isRecord(schema.items) ? schema.items : {};
    return values.flatMap((value) => {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return parsed.map((item) => coerceScalar(item, itemSchema, cliName));
      } catch {
        // Fall back to comma-separated values.
      }
      return value.split(",").map((item) => coerceScalar(item, itemSchema, cliName));
    });
  }
  if (type === "object") {
    try {
      const parsed = JSON.parse(values.at(-1)!);
      if (!isRecord(parsed)) throw new Error();
      return parsed;
    } catch {
      throw new Error(`--${cliName} requires a JSON object`);
    }
  }
  return coerceScalar(values.at(-1)!, schema, cliName);
}

function coerceScalar(value: unknown, schema: Record<string, unknown>, cliName: string): unknown {
  const type = schemaType(schema);
  let result: unknown = value;
  if (type === "boolean") {
    if (value === true || value === "true") result = true;
    else if (value === false || value === "false") result = false;
    else throw new Error(`--${cliName} requires true or false`);
  } else if (type === "integer") {
    result = Number(value);
    if (!Number.isInteger(result)) throw new Error(`--${cliName} requires an integer`);
  } else if (type === "number") {
    result = Number(value);
    if (!Number.isFinite(result)) throw new Error(`--${cliName} requires a number`);
  } else if (type === "string") {
    result = String(value);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === result)) {
    throw new Error(`--${cliName} must be one of: ${schema.enum.join(", ")}`);
  }
  return result;
}

function schemaType(schema: Record<string, unknown>): string {
  const raw = schema.type;
  if (Array.isArray(raw)) {
    return raw.find((item) => item !== "null") as string ?? "string";
  }
  if (typeof raw === "string") return raw;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const type = typeof schema.enum[0];
    return type === "number" ? "number" : type === "boolean" ? "boolean" : "string";
  }
  return "string";
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} requires a positive integer`);
  return parsed;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      value += chunk;
    });
    process.stdin.on("end", () => resolve(value));
    process.stdin.on("error", reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
