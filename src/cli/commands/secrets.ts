import { readFileSync } from "node:fs";
import type { Command } from "commander";
import {
  KeychainSecretStore,
  assertSecretName,
  collectSecretUsages,
  createSecretStore,
  migrateSecretStore,
  secretReferenceName,
  writeConfig,
  type OmniMcpConfig,
} from "../../config/index.js";
import { DEFAULT_CONFIG_PATH, DEFAULT_SECRETS_PATH } from "../config-path.js";
import { readPidFile } from "../pid.js";

interface CommonOptions {
  config: string;
  json?: boolean;
}

export function registerSecretsCommand(program: Command): void {
  const secrets = program.command("secrets").description("Manage write-only variables and secret backends");

  secrets
    .command("list")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction((options: CommonOptions) => listSecrets(options)));

  secrets
    .command("status")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction((options: CommonOptions) => listSecrets(options)));

  secrets
    .command("get-status")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction((options: CommonOptions) => listSecrets(options)));

  secrets
    .command("set <name>")
    .description("Create or replace a secret (value is read from a hidden prompt or stdin)")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--stdin", "Read the value from stdin")
    .action(safeAction(async (name: string, options: CommonOptions & { stdin?: boolean }) => {
      const { rawConfig } = requireConfig(options.config);
      const value = options.stdin || !process.stdin.isTTY
        ? readFileSync(0, "utf8").replace(/\r?\n$/, "")
        : await hiddenPrompt(`Value for ${name}: `);
      createSecretStore(rawConfig.secretStore).set(name, value);
      notifyRunningGateway();
      process.stdout.write(`[omni-mcp] Secret "${name}" saved (${rawConfig.secretStore.backend}).\n`);
    }));

  secrets
    .command("delete <name>")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .action(safeAction((name: string, options: CommonOptions) => {
      const { rawConfig } = requireConfig(options.config);
      const usages = collectSecretUsages(rawConfig)[name] ?? [];
      if (usages.length > 0) {
        throw new Error(`Secret "${name}" is referenced by ${usages.map((usage) => usage.path).join(", ")}`);
      }
      if (!createSecretStore(rawConfig.secretStore).delete(name)) {
        throw new Error(`Secret "${name}" was not found`);
      }
      notifyRunningGateway();
      process.stdout.write(`[omni-mcp] Secret "${name}" deleted.\n`);
    }));

  secrets
    .command("sync")
    .description("Validate and refresh variables from the active backend")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .action(safeAction((options: CommonOptions) => {
      const { rawConfig } = requireConfig(options.config);
      const count = createSecretStore(rawConfig.secretStore).list().length;
      notifyRunningGateway();
      process.stdout.write(`[omni-mcp] Synced ${count} secret(s) from ${rawConfig.secretStore.backend}.\n`);
    }));

  secrets
    .command("import-keychain [name]")
    .requiredOption("--service <service>", "Source Keychain service")
    .requiredOption("--account <account>", "Source Keychain account")
    .option("--name <name>", "Destination variable name")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .action(safeAction((positionalName: string | undefined, options: CommonOptions & { service: string; account: string; name?: string }) => {
      const name = options.name ?? positionalName;
      if (!name) throw new Error("Destination variable name is required");
      const { rawConfig } = requireConfig(options.config);
      const value = new KeychainSecretStore(options.service).readAccount(options.account);
      if (!value) throw new Error(`Keychain item ${options.service}/${options.account} was not found`);
      createSecretStore(rawConfig.secretStore).set(name, value);
      notifyRunningGateway();
      process.stdout.write(`[omni-mcp] Imported Keychain item as "${name}".\n`);
    }));

  secrets
    .command("migrate")
    .description("Migrate the backend or replace inline config secrets with references")
    .option("--backend <backend>", "Destination backend: file or keychain")
    .option("--inline", "Migrate inline server env/JWT values")
    .option("--apply", "Apply inline migration (otherwise preview)")
    .option("--preview", "Preview inline migration")
    .option("--rename <mapping...>", "Rename collisions as NAME=NEW_NAME")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction((options: CommonOptions & { backend?: string; inline?: boolean; apply?: boolean; rename?: string[] }) => {
      const { rawConfig } = requireConfig(options.config);
      if (options.backend) {
        if (options.backend !== "file" && options.backend !== "keychain") {
          throw new Error('Backend must be "file" or "keychain"');
        }
        if (options.backend === rawConfig.secretStore.backend) {
          process.stdout.write("[omni-mcp] Secret backend is already active.\n");
          return;
        }
        const destination: OmniMcpConfig["secretStore"] = {
          ...rawConfig.secretStore,
          backend: options.backend,
        };
        const sourceStore = createSecretStore(rawConfig.secretStore);
        const destinationStore = createSecretStore(destination);
        const count = migrateSecretStore(sourceStore, destinationStore);
        rawConfig.secretStore = destination;
        try {
          writeConfig(options.config, rawConfig);
        } catch (error) {
          migrateSecretStore(destinationStore, sourceStore);
          throw error;
        }
        notifyRunningGateway();
        process.stdout.write(`[omni-mcp] Migrated ${count} secret(s) to ${options.backend}.\n`);
        return;
      }
      if (!options.inline) throw new Error("Choose --backend <backend> or --inline");
      const renames = parseRenames(options.rename ?? []);
      const candidates = cliInlineCandidates(rawConfig).map((candidate) => ({
        ...candidate,
        name: renames[candidate.name] ?? candidate.name,
      }));
      const store = createSecretStore(rawConfig.secretStore);
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
          store.set(candidate.name, candidate.value);
          candidate.apply(candidate.name);
        }
        writeConfig(options.config, rawConfig);
      } catch (error) {
        for (const [name, oldValue] of previous) {
          if (oldValue === undefined) store.delete(name);
          else store.set(name, oldValue);
        }
        throw error;
      }
      notifyRunningGateway();
      process.stdout.write(`[omni-mcp] Migrated ${candidates.length} inline secret(s).\n`);
    }));
}

function safeAction<T extends unknown[]>(
  action: (...args: T) => void | Promise<void>,
): (...args: T) => Promise<void> {
  return async (...args) => {
    try {
      await action(...args);
    } catch (error) {
      process.stderr.write(
        `[omni-mcp] ERROR: ${error instanceof Error ? error.message : "Secret operation failed"}\n`,
      );
      process.exitCode = 1;
    }
  };
}

function notifyRunningGateway(): void {
  const pid = readPidFile();
  if (!pid) return;
  try {
    process.kill(pid, "SIGHUP");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

function listSecrets(options: CommonOptions): void {
  const { rawConfig } = requireConfig(options.config);
  const store = createSecretStore(rawConfig.secretStore);
  const usages = collectSecretUsages(rawConfig);
  const storeNames = store.list();
  const names = new Set([...storeNames, ...Object.keys(usages)]);
  const payload = {
    backend: rawConfig.secretStore.backend,
    path: rawConfig.secretStore.backend === "file" ? DEFAULT_SECRETS_PATH : undefined,
    keychainService: rawConfig.secretStore.keychainService,
    keychainSupported: process.platform === "darwin",
    count: storeNames.length,
    secrets: [...names].sort().map((name) => ({
      name,
      set: store.get(name) !== undefined,
      usages: usages[name] ?? [],
    })),
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`Backend: ${payload.backend}\n`);
  if (payload.secrets.length === 0) {
    process.stdout.write("No secrets configured.\n");
    return;
  }
  for (const secret of payload.secrets) {
    process.stdout.write(`${secret.set ? "set" : "unset"}  ${secret.name}  ${secret.usages.length} use(s)\n`);
  }
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
  rawConfig.secretStore ??= { backend: "file", keychainService: "omni-mcp" };
  return { rawConfig };
}

async function hiddenPrompt(label: string): Promise<string> {
  process.stderr.write(label);
  const input = process.stdin;
  if (!input.setRawMode) throw new Error("A TTY or --stdin is required");
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolve, reject) => {
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
        resolve(value);
      } else if (chunk === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += chunk;
      }
    };
    input.on("data", onData);
  });
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
  store?: { get(name: string): string | undefined },
): string[] {
  const values = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const candidate of candidates) {
    const previous = values.get(candidate.name);
    if (previous !== undefined && previous !== candidate.value) conflicts.add(candidate.name);
    const stored = store?.get(candidate.name);
    if (stored !== undefined && stored !== candidate.value) conflicts.add(candidate.name);
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

