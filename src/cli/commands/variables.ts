import { readFileSync } from "node:fs";
import type { Command } from "commander";
import {
  KeychainSecretStore,
  VariableStore,
  assertSecretName,
  collectSecretUsages,
  createSecretStore,
  migrateSecretStore,
  secretReferenceName,
  writeConfig,
  type ManagedVariable,
  type OmniMcpConfig,
  type VariableType,
} from "../../config/index.js";
import { DEFAULT_CONFIG_PATH, DEFAULT_SECRETS_PATH, DEFAULT_VARIABLES_PATH } from "../config-path.js";
import { matchingGateway } from "../http-client.js";

interface CommonOptions {
  config: string;
  json?: boolean;
}

interface VariablesPayload {
  secretBackend: string;
  variablesPath: string;
  secretPath?: string;
  secretCount: number;
  plainCount: number;
  variables: Array<ManagedVariable & { usages: unknown[] }>;
}

export function registerVariablesCommand(program: Command): void {
  const variables = program.command("variables").description("Manage typed config Variables");

  for (const commandName of ["list", "status"] as const) {
    variables.command(commandName)
      .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
      .option("--json", "Output machine-readable JSON")
      .action(safeAction((options: CommonOptions) => listVariables(options)));
  }

  variables.command("show <name>")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction(async (name: string, options: CommonOptions) => {
      const payload = await variablesPayload(options);
      const variable = payload.variables.find((item) => item.name === name);
      if (!variable) throw new Error(`Variable "${name}" was not found`);
      if (options.json) process.stdout.write(`${JSON.stringify(variable)}\n`);
      else printVariable(variable);
    }));

  variables.command("set <name>")
    .description("Create or replace a Variable")
    .option("--type <type>", "Variable type: secret or plain", "secret")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--stdin", "Read the value from stdin")
    .action(safeAction(async (
      name: string,
      options: CommonOptions & { stdin?: boolean; type: string },
    ) => {
      const type = parseVariableType(options.type);
      const value = options.stdin || !process.stdin.isTTY
        ? readFileSync(0, "utf8").replace(/\r?\n$/, "")
        : type === "secret"
          ? await hiddenPrompt(`Value for ${name}: `)
          : await visiblePrompt(`Value for ${name}: `);
      const live = await matchingGateway(options.config);
      if (live) {
        await live.client.request(`/api/variables/${encodeURIComponent(name)}`, {
          method: "PUT", body: JSON.stringify({ type, value }),
        });
        process.stdout.write(`[omni-mcp] Variable "${name}" saved.\n`);
        return;
      }
      const { rawConfig } = requireConfig(options.config);
      variableStore(rawConfig).set(name, value, type);
      process.stdout.write(`[omni-mcp] ${type === "secret" ? "Secret" : "Plain"} Variable "${name}" saved.\n`);
      offlineNotice(options.config);
    }));

  variables.command("convert <name>")
    .requiredOption("--type <type>", "Destination type: secret or plain")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--yes", "Skip confirmation")
    .action(safeAction(async (
      name: string,
      options: CommonOptions & { type: string; yes?: boolean },
    ) => {
      const type = parseVariableType(options.type);
      await confirmAction(`Convert Variable "${name}" to ${type}?`, options.yes);
      const live = await matchingGateway(options.config);
      if (live) {
        await live.client.request(`/api/variables/${encodeURIComponent(name)}/type`, {
          method: "PUT", body: JSON.stringify({ type }),
        });
      } else {
        const { rawConfig } = requireConfig(options.config);
        variableStore(rawConfig).convert(name, type);
        offlineNotice(options.config);
      }
      process.stdout.write(`[omni-mcp] Variable "${name}" converted to ${type}.\n`);
    }));

  variables.command("delete <name>")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--yes", "Skip confirmation")
    .action(safeAction(async (
      name: string,
      options: CommonOptions & { yes?: boolean },
    ) => {
      await confirmAction(`Delete Variable "${name}"?`, options.yes);
      const live = await matchingGateway(options.config);
      if (live) {
        await live.client.request(`/api/variables/${encodeURIComponent(name)}`, { method: "DELETE" });
      } else {
        const { rawConfig } = requireConfig(options.config);
        const usages = collectSecretUsages(rawConfig)[name] ?? [];
        if (usages.length > 0) {
          throw new Error(`Variable "${name}" is referenced by ${usages.map((usage) => usage.path).join(", ")}`);
        }
        if (!variableStore(rawConfig).delete(name)) throw new Error(`Variable "${name}" was not found`);
        offlineNotice(options.config);
      }
      process.stdout.write(`[omni-mcp] Variable "${name}" deleted.\n`);
    }));

  variables.command("sync")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction(async (options: CommonOptions) => {
      const live = await matchingGateway(options.config);
      const payload = live
        ? await live.client.request<VariablesPayload>("/api/variables/sync", { method: "POST" })
        : await variablesPayload(options);
      if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
      else process.stdout.write(
        `[omni-mcp] Synced ${payload.secretCount} secret and ${payload.plainCount} plain Variable(s).\n`,
      );
      if (!live && !options.json) offlineNotice(options.config);
    }));

  variables.command("import-keychain [name]")
    .requiredOption("--service <service>", "Source Keychain service")
    .requiredOption("--account <account>", "Source Keychain account")
    .option("--name <name>", "Destination variable name")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .action(safeAction(async (
      positionalName: string | undefined,
      options: CommonOptions & { service: string; account: string; name?: string },
    ) => {
      const name = options.name ?? positionalName;
      if (!name) throw new Error("Destination Variable name is required");
      const live = await matchingGateway(options.config);
      if (live) {
        await live.client.request("/api/variables/import-keychain", {
          method: "POST",
          body: JSON.stringify({ name, service: options.service, account: options.account }),
        });
      } else {
        const { rawConfig } = requireConfig(options.config);
        const value = new KeychainSecretStore(options.service).readAccount(options.account);
        if (!value) throw new Error(`Keychain item ${options.service}/${options.account} was not found`);
        variableStore(rawConfig).set(name, value, "secret");
        offlineNotice(options.config);
      }
      process.stdout.write(`[omni-mcp] Imported Keychain item as secret Variable "${name}".\n`);
    }));

  variables.command("migrate")
    .option("--secret-backend <backend>", "Destination secret backend: file or keychain")
    .option("--inline", "Migrate inline server env/JWT values")
    .option("--apply", "Apply inline migration")
    .option("--rename <mapping...>", "Rename collisions as NAME=NEW_NAME")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction(async (
      options: CommonOptions & {
        secretBackend?: string;
        inline?: boolean;
        apply?: boolean;
        rename?: string[];
      },
    ) => {
      const backend = options.secretBackend;
      if (backend && backend !== "file" && backend !== "keychain") {
        throw new Error('Secret backend must be "file" or "keychain"');
      }
      const live = await matchingGateway(options.config);
      if (backend) {
        if (live) {
          const payload = await live.client.request<Record<string, unknown>>(
            "/api/variables/secret-backend",
            { method: "POST", body: JSON.stringify({ backend }) },
          );
          if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
          else process.stdout.write(`[omni-mcp] Migrated ${String(payload.migrated ?? 0)} secret Variable(s) to ${backend}.\n`);
          return;
        }
        const { rawConfig } = requireConfig(options.config);
        if (backend === rawConfig.secretBackend.backend) {
          process.stdout.write("[omni-mcp] Secret backend is already active.\n");
          return;
        }
        const destination: OmniMcpConfig["secretBackend"] = {
          ...rawConfig.secretBackend,
          backend: backend as "file" | "keychain",
        };
        const sourceStore = createSecretStore(rawConfig.secretBackend);
        const destinationStore = createSecretStore(destination);
        const count = migrateSecretStore(sourceStore, destinationStore);
        rawConfig.secretBackend = destination;
        try {
          writeConfig(options.config, rawConfig);
        } catch (error) {
          migrateSecretStore(destinationStore, sourceStore);
          throw error;
        }
        process.stdout.write(`[omni-mcp] Migrated ${count} secret Variable(s) to ${backend}.\n`);
        offlineNotice(options.config);
        return;
      }

      if (!options.inline) throw new Error("Choose --secret-backend <backend> or --inline");
      const renames = parseRenames(options.rename ?? []);
      if (live) {
        const payload = options.apply
          ? await live.client.request<Record<string, unknown>>("/api/variables/migrate-inline", {
              method: "POST", body: JSON.stringify({ renames }),
            })
          : await live.client.request<Record<string, unknown>>("/api/variables/migrate-inline");
        if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
        else if (options.apply) {
          process.stdout.write(`[omni-mcp] Migrated ${String(payload.migrated ?? 0)} inline Variable(s).\n`);
        } else {
          const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
          for (const item of candidates as Array<{ path?: string; server: string; field: string; envKey?: string; name: string }>) {
            const path = item.path ?? (item.field === "env"
              ? `servers.${item.server}.env.${item.envKey}`
              : `servers.${item.server}.auth.token`);
            process.stdout.write(`${path} -> $${item.name}\n`);
          }
        }
        return;
      }

      const { rawConfig } = requireConfig(options.config);
      const candidates = cliInlineCandidates(rawConfig).map((candidate) => ({
        ...candidate,
        name: renames[candidate.name] ?? candidate.name,
      }));
      const store = variableStore(rawConfig);
      const conflicts = inlineConflicts(candidates, store);
      if (conflicts.length > 0) {
        throw new Error(`Inline migration has variable-name collisions: ${conflicts.join(", ")}`);
      }
      const safe = candidates.map(({ value: _value, ...candidate }) => candidate);
      if (!options.apply) {
        process.stdout.write(options.json
          ? `${JSON.stringify({ candidates: safe })}\n`
          : safe.map((item) => `${item.path} -> $${item.name}`).join("\n") + "\n");
        return;
      }
      const previous = new Map<string, string | undefined>();
      try {
        for (const candidate of candidates) {
          if (!previous.has(candidate.name)) previous.set(candidate.name, store.get(candidate.name));
          store.set(candidate.name, candidate.value, "secret");
          candidate.apply(candidate.name);
        }
        writeConfig(options.config, rawConfig);
      } catch (error) {
        for (const [name, oldValue] of previous) {
          if (oldValue === undefined) store.delete(name);
          else store.set(name, oldValue, "secret");
        }
        throw error;
      }
      process.stdout.write(`[omni-mcp] Migrated ${candidates.length} inline Variable(s).\n`);
      offlineNotice(options.config);
    }));
}

async function listVariables(options: CommonOptions): Promise<void> {
  const payload = await variablesPayload(options);
  if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
  else printVariablesPayload(payload);
}

async function variablesPayload(options: CommonOptions): Promise<VariablesPayload> {
  const live = await matchingGateway(options.config);
  if (live) return live.client.request<VariablesPayload>("/api/variables");
  const { rawConfig } = requireConfig(options.config);
  const store = variableStore(rawConfig);
  const usages = collectSecretUsages(rawConfig);
  const stored = store.list();
  const storedByName = new Map(stored.map((item) => [item.name, item]));
  const names = new Set([...storedByName.keys(), ...Object.keys(usages)]);
  const variables = [...names].sort().map((name) => ({
    name,
    type: storedByName.get(name)?.type ?? "secret" as const,
    set: storedByName.get(name)?.set ?? false,
    ...(storedByName.get(name)?.type === "plain" ? { value: storedByName.get(name)?.value } : {}),
    usages: usages[name] ?? [],
  }));
  return {
    secretBackend: rawConfig.secretBackend.backend,
    secretPath: rawConfig.secretBackend.backend === "file" ? DEFAULT_SECRETS_PATH : undefined,
    variablesPath: DEFAULT_VARIABLES_PATH,
    secretCount: variables.filter((item) => item.type === "secret" && item.set).length,
    plainCount: variables.filter((item) => item.type === "plain" && item.set).length,
    variables,
  };
}

function printVariablesPayload(payload: VariablesPayload): void {
  process.stdout.write(`Secret backend: ${payload.secretBackend}\n`);
  if (payload.variables.length === 0) {
    process.stdout.write("No Variables configured.\n");
    return;
  }
  for (const variable of payload.variables) printVariable(variable);
}

function printVariable(variable: ManagedVariable & { usages: unknown[] }): void {
  const value = variable.type === "plain" ? `  ${variable.value ?? ""}` : "";
  process.stdout.write(
    `${variable.type}  ${variable.set ? "set" : "unset"}  ${variable.name}${value}  ${variable.usages.length} use(s)\n`,
  );
}

function variableStore(config: OmniMcpConfig): VariableStore {
  return new VariableStore(createSecretStore(config.secretBackend));
}

function requireConfig(path: string): { rawConfig: OmniMcpConfig } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Failed to read config ${path}: ${error instanceof Error ? error.message : "invalid JSON"}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Config ${path} must contain a JSON object`);
  }
  const rawConfig = parsed as OmniMcpConfig;
  rawConfig.secretBackend ??= { backend: "file", keychainService: "omni-mcp" };
  return { rawConfig };
}

function parseVariableType(value: string): VariableType {
  if (value !== "secret" && value !== "plain") {
    throw new Error('Variable type must be "secret" or "plain"');
  }
  return value;
}

function offlineNotice(configPath: string): void {
  process.stdout.write(
    `[omni-mcp] Updated ${configPath} offline. Any running gateway was not refreshed; run \`omni-mcp reload --config ${configPath}\`.\n`,
  );
}

async function confirmAction(message: string, yes?: boolean): Promise<void> {
  if (yes) return;
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

async function visiblePrompt(label: string): Promise<string> {
  process.stderr.write(label);
  return new Promise((resolveValue) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (chunk) => resolveValue(String(chunk).replace(/\r?\n$/, "")));
  });
}

async function hiddenPrompt(label: string): Promise<string> {
  process.stderr.write(label);
  const input = process.stdin;
  if (!input.setRawMode) throw new Error("A TTY or --stdin is required");
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolveValue, reject) => {
    let value = "";
    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      process.stderr.write("\n");
    };
    const onData = (chunk: string) => {
      if (chunk === "\u0003") {
        cleanup();
        reject(new Error("Cancelled"));
      } else if (chunk === "\r" || chunk === "\n") {
        cleanup();
        resolveValue(value);
      } else if (chunk === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += chunk;
      }
    };
    input.on("data", onData);
  });
}

function safeAction<T extends unknown[]>(
  action: (...args: T) => void | Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      process.stderr.write(
        `[omni-mcp] ERROR: ${error instanceof Error ? error.message : "Variable operation failed"}\n`,
      );
      process.exitCode = 1;
    }
  };
}

interface CliInlineCandidate {
  name: string;
  path: string;
  value: string;
  apply: (name: string) => void;
}

export function cliInlineCandidates(config: OmniMcpConfig): CliInlineCandidate[] {
  const result: CliInlineCandidate[] = [];
  for (const [serverName, server] of Object.entries(config.servers)) {
    if (server.type === "stdio") {
      for (const [key, value] of Object.entries(server.env ?? {})) {
        if (secretReferenceName(value) || value === "********") continue;
        const name = normalizeName(key || `${serverName}_ENV`);
        result.push({
          name,
          path: `servers.${serverName}.env.${key}`,
          value,
          apply: (resolvedName) => { server.env![key] = `$${resolvedName}`; },
        });
      }
    } else if (server.auth?.token && !secretReferenceName(server.auth.token) && server.auth.token !== "********") {
      const name = normalizeName(`${serverName}_TOKEN`);
      result.push({
        name,
        path: `servers.${serverName}.auth.token`,
        value: server.auth.token,
        apply: (resolvedName) => { server.auth!.token = `$${resolvedName}`; },
      });
    }
  }
  return result;
}

function normalizeName(value: string): string {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return /^[A-Z_]/.test(normalized) ? normalized : `_${normalized}`;
}

export function inlineConflicts(
  candidates: CliInlineCandidate[],
  store?: { get(name: string): string | undefined; getType?(name: string): VariableType | undefined },
): string[] {
  const values = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const candidate of candidates) {
    const previous = values.get(candidate.name);
    if (previous !== undefined && previous !== candidate.value) conflicts.add(candidate.name);
    const stored = store?.get(candidate.name);
    if (
      store?.getType?.(candidate.name) === "plain" ||
      (stored !== undefined && stored !== candidate.value)
    ) {
      conflicts.add(candidate.name);
    }
    values.set(candidate.name, candidate.value);
  }
  return [...conflicts].sort();
}

export function parseRenames(mappings: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const mapping of mappings) {
    const separator = mapping.indexOf("=");
    if (separator < 1 || separator === mapping.length - 1) {
      throw new Error(`Invalid rename "${mapping}". Use NAME=NEW_NAME.`);
    }
    const from = mapping.slice(0, separator);
    const to = mapping.slice(separator + 1);
    assertSecretName(from);
    assertSecretName(to);
    result[from] = to;
  }
  return result;
}
