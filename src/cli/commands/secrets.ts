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
import { matchingGateway } from "../http-client.js";

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
      const value = options.stdin || !process.stdin.isTTY
        ? readFileSync(0, "utf8").replace(/\r?\n$/, "")
        : await hiddenPrompt(`Value for ${name}: `);
      const live = await matchingGateway(options.config);
      if (live) {
        await live.client.request(`/api/secrets/${encodeURIComponent(name)}`, {
          method: "PUT", body: JSON.stringify({ value }),
        });
        process.stdout.write(`[omni-mcp] Secret "${name}" saved through the running gateway.\n`);
        return;
      }
      const { rawConfig } = requireConfig(options.config);
      createSecretStore(rawConfig.secretStore).set(name, value);
      process.stdout.write(`[omni-mcp] Secret "${name}" saved (${rawConfig.secretStore.backend}).\n`);
      offlineNotice(options.config);
    }));

  secrets
    .command("delete <name>")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--yes", "Skip confirmation")
    .action(safeAction(async (name: string, options: CommonOptions & { yes?: boolean }) => {
      await confirmDelete(name, options.yes);
      const live = await matchingGateway(options.config);
      if (live) {
        await live.client.request(`/api/secrets/${encodeURIComponent(name)}`, { method: "DELETE" });
        process.stdout.write(`[omni-mcp] Secret "${name}" deleted.\n`);
        return;
      }
      const { rawConfig } = requireConfig(options.config);
      const usages = collectSecretUsages(rawConfig)[name] ?? [];
      if (usages.length > 0) {
        throw new Error(`Secret "${name}" is referenced by ${usages.map((usage) => usage.path).join(", ")}`);
      }
      if (!createSecretStore(rawConfig.secretStore).delete(name)) {
        throw new Error(`Secret "${name}" was not found`);
      }
      process.stdout.write(`[omni-mcp] Secret "${name}" deleted.\n`);
      offlineNotice(options.config);
    }));

  secrets
    .command("sync")
    .description("Validate and refresh variables from the active backend")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction(async (options: CommonOptions) => {
      const live = await matchingGateway(options.config);
      if (live) {
        const payload = await live.client.request<Record<string, unknown>>("/api/secrets/sync", { method: "POST" });
        if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
        else process.stdout.write(`[omni-mcp] Synced ${String(payload.count ?? 0)} secret(s) from ${String(payload.backend)}.\n`);
        return;
      }
      const { rawConfig } = requireConfig(options.config);
      const count = createSecretStore(rawConfig.secretStore).list().length;
      if (options.json) process.stdout.write(`${JSON.stringify({ backend: rawConfig.secretStore.backend, count })}\n`);
      else {
        process.stdout.write(`[omni-mcp] Validated ${count} secret(s) from ${rawConfig.secretStore.backend} offline.\n`);
        offlineNotice(options.config);
      }
    }));

  secrets
    .command("backend <backend>")
    .description("Preview a secret backend migration")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .option("--json", "Output machine-readable JSON")
    .action(safeAction(async (backend: string, options: CommonOptions) => {
      if (backend !== "file" && backend !== "keychain") throw new Error('Backend must be "file" or "keychain"');
      const live = await matchingGateway(options.config);
      let payload: Record<string, unknown>;
      if (live) {
        payload = await live.client.request(`/api/secrets/backend?backend=${backend}`);
      } else {
        const { rawConfig } = requireConfig(options.config);
        payload = {
          from: rawConfig.secretStore.backend,
          to: backend,
          count: createSecretStore(rawConfig.secretStore).list().length,
          keychainSupported: process.platform === "darwin",
        };
      }
      if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
      else process.stdout.write(`Backend migration: ${String(payload.from)} -> ${String(payload.to)} (${String(payload.count)} secret(s))\n`);
    }));

  secrets
    .command("import-keychain [name]")
    .requiredOption("--service <service>", "Source Keychain service")
    .requiredOption("--account <account>", "Source Keychain account")
    .option("--name <name>", "Destination variable name")
    .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
    .action(safeAction(async (positionalName: string | undefined, options: CommonOptions & { service: string; account: string; name?: string }) => {
      const name = options.name ?? positionalName;
      if (!name) throw new Error("Destination variable name is required");
      const live = await matchingGateway(options.config);
      if (live) {
        await live.client.request("/api/secrets/import-keychain", {
          method: "POST",
          body: JSON.stringify({ name, service: options.service, account: options.account }),
        });
        process.stdout.write(`[omni-mcp] Imported Keychain item as "${name}".\n`);
        return;
      }
      const { rawConfig } = requireConfig(options.config);
      const value = new KeychainSecretStore(options.service).readAccount(options.account);
      if (!value) throw new Error(`Keychain item ${options.service}/${options.account} was not found`);
      createSecretStore(rawConfig.secretStore).set(name, value);
      process.stdout.write(`[omni-mcp] Imported Keychain item as "${name}".\n`);
      offlineNotice(options.config);
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
    .action(safeAction(async (options: CommonOptions & { backend?: string; inline?: boolean; apply?: boolean; rename?: string[] }) => {
      const live = await matchingGateway(options.config);
      const renames = parseRenames(options.rename ?? []);
      if (live && options.backend) {
        if (options.backend !== "file" && options.backend !== "keychain") {
          throw new Error('Backend must be "file" or "keychain"');
        }
        const payload = await live.client.request<Record<string, unknown>>("/api/secrets/backend", {
          method: "POST", body: JSON.stringify({ backend: options.backend }),
        });
        if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
        else process.stdout.write(`[omni-mcp] Migrated ${String(payload.migrated ?? 0)} secret(s) to ${options.backend}.\n`);
        return;
      }
      if (live && options.inline) {
        const payload = options.apply
          ? await live.client.request<Record<string, unknown>>("/api/secrets/migrate-inline", {
              method: "POST", body: JSON.stringify({ renames }),
            })
          : await live.client.request<Record<string, unknown>>("/api/secrets/migrate-inline");
        if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
        else if (options.apply) process.stdout.write(`[omni-mcp] Migrated ${String(payload.migrated ?? 0)} inline secret(s).\n`);
        else {
          const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
          for (const candidate of candidates as Array<{ server: string; field: string; envKey?: string; name: string }>) {
            const path = candidate.field === "env"
              ? `servers.${candidate.server}.env.${candidate.envKey}`
              : `servers.${candidate.server}.auth.token`;
            process.stdout.write(`${path} -> $${candidate.name}\n`);
          }
        }
        return;
      }
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
        process.stdout.write(`[omni-mcp] Migrated ${count} secret(s) to ${options.backend}.\n`);
        offlineNotice(options.config);
        return;
      }
      if (!options.inline) throw new Error("Choose --backend <backend> or --inline");
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
      process.stdout.write(`[omni-mcp] Migrated ${candidates.length} inline secret(s).\n`);
      offlineNotice(options.config);
    }));
}

function offlineNotice(configPath: string): void {
  process.stdout.write(
    `[omni-mcp] Updated ${configPath} offline. Any running gateway was not refreshed; run \`omni-mcp reload --config ${configPath}\`.\n`,
  );
}

async function confirmDelete(name: string, yes?: boolean): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Confirmation required; rerun with --yes");
  }
  process.stderr.write(`Delete secret "${name}"? [y/N] `);
  const answer = await new Promise<string>((resolveAnswer) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (chunk) => resolveAnswer(String(chunk).trim()));
  });
  if (!/^y(?:es)?$/i.test(answer)) throw new Error("Cancelled");
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

async function listSecrets(options: CommonOptions): Promise<void> {
  const live = await matchingGateway(options.config);
  if (live) {
    const payload = await live.client.request<Record<string, unknown>>("/api/secrets");
    if (options.json) process.stdout.write(`${JSON.stringify(payload)}\n`);
    else printSecretsPayload(payload as {
      backend: string;
      secrets: Array<{ name: string; set: boolean; usages: unknown[] }>;
    });
    return;
  }
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
  printSecretsPayload(payload);
}

function printSecretsPayload(payload: {
  backend: string;
  secrets: Array<{ name: string; set: boolean; usages: unknown[] }>;
}): void {
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

