import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { configSchema, type OmniMcpConfig } from "./schema.js";
import { resolveEnvVariables } from "./env.js";
import { DEFAULT_CONFIG_PATH } from "../cli/config-path.js";
import { collectCrossFieldIssues } from "./validate.js";
import { createSecretStore, type SecretStoreOptions } from "./secret-store.js";
import { VariableStore, type VariableStoreOptions } from "./variable-store.js";

export interface ValidationError {
  message: string;
}

export interface ValidationWarning {
  message: string;
}

export interface LoadConfigResult {
  config?: OmniMcpConfig;
  rawConfig?: OmniMcpConfig;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  /** Enabled servers that cannot start yet, with the reasons (e.g. unresolved Variables). */
  serverIssues: Record<string, string[]>;
  /** Problems not tied to one server, such as an unavailable secret backend. */
  globalIssues: string[];
}

export interface ResolveConfigOptions extends SecretStoreOptions, VariableStoreOptions {
  env?: Record<string, string | undefined>;
}

/**
 * Loads and validates the omni-mcp config file.
 * Resolves environment variables and performs cross-field validation.
 */
export function loadConfig(
  configPath?: string,
  env?: Record<string, string | undefined>,
): LoadConfigResult {
  const resolvedPath = resolve(configPath ?? DEFAULT_CONFIG_PATH);
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Check file exists
  if (!existsSync(resolvedPath)) {
    errors.push({ message: `Config file not found: ${resolvedPath}` });
    return { errors, warnings, serverIssues: {}, globalIssues: [] };
  }

  // Parse JSON
  let rawConfig: Record<string, unknown>;
  try {
    const content = readFileSync(resolvedPath, "utf-8");
    rawConfig = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown parse error";
    errors.push({ message: `Failed to parse config file: ${message}` });
    return { errors, warnings, serverIssues: {}, globalIssues: [] };
  }

  return resolveConfig(rawConfig, { env });
}

export function resolveConfig(
  rawConfig: Record<string, unknown>,
  options: ResolveConfigOptions = {},
): LoadConfigResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const serverIssues: Record<string, string[]> = {};
  const globalIssues: string[] = [];
  const fail = (): LoadConfigResult => ({ errors, warnings, serverIssues, globalIssues });
  const storeConfigResult = configSchema.shape.secretBackend.safeParse(rawConfig.secretBackend);
  const storeConfig = storeConfigResult.success
    ? storeConfigResult.data
    : { backend: "file" as const, keychainService: "omni-mcp" as const };

  // A broken secret backend must not stop the gateway: treat every reference
  // as unresolved so the affected servers are blocked and the UI stays reachable.
  let variables: Pick<VariableStore, "get"> | undefined;
  const reportStoreFailure = (error: unknown): void => {
    if (globalIssues.length > 0) return;
    const reason = error instanceof Error ? error.message : "unknown error";
    globalIssues.push(`Secret backend "${storeConfig.backend}" is unavailable: ${reason}`);
  };
  try {
    const store = new VariableStore(createSecretStore(storeConfig, options), options);
    variables = {
      get: (name) => {
        try {
          return store.get(name);
        } catch (error) {
          reportStoreFailure(error);
          return undefined;
        }
      },
    };
  } catch (error) {
    reportStoreFailure(error);
  }

  const result = resolveEnvVariables(rawConfig, options.env ?? process.env, variables);
  const resolved = result.resolved;
  for (const message of globalIssues) warnings.push({ message });
  for (const envErr of result.errors) {
    const detail = `${envErr.path} references "${envErr.variable}", which is not set in the environment or managed Variables`;
    const server = serverNameForPath(envErr.path);
    if (server && isServerDisabled(rawConfig, server)) {
      warnings.push({ message: `${detail} — server "${server}" is disabled` });
    } else if (server) {
      (serverIssues[server] ??= []).push(detail);
      warnings.push({ message: `server "${server}" not started: ${detail}` });
    } else {
      errors.push({ message: `${envErr.path}: neither the process environment nor managed Variables define "${envErr.variable}"` });
    }
  }

  if (errors.length > 0) return fail();

  // Schema validation
  const parseResult = configSchema.safeParse(resolved);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join(".");
      errors.push({ message: `${path}: ${issue.message}` });
    }
    return fail();
  }

  const config = parseResult.data;
  collectCrossFieldIssues(config, errors, warnings);

  if (errors.length > 0) {
    return fail();
  }

  return {
    config,
    rawConfig: overlayRawConfig(config, rawConfig) as OmniMcpConfig,
    errors,
    warnings,
    serverIssues,
    globalIssues,
  };
}

/** Returns the server name for a resolved-config path like `servers.jira.env.TOKEN`. */
function serverNameForPath(path: string): string | undefined {
  return /^servers\.([^.[]+)[.[]/.exec(path)?.[1];
}

/** A disabled server never spawns, so its unresolved references only warn. */
function isServerDisabled(rawConfig: Record<string, unknown>, name: string): boolean {
  const servers = rawConfig.servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return false;
  const server = (servers as Record<string, unknown>)[name];
  return Boolean(server) &&
    typeof server === "object" &&
    (server as { enabled?: unknown }).enabled === false;
}

function overlayRawConfig(defaulted: unknown, raw: unknown): unknown {
  if (Array.isArray(defaulted)) {
    if (!Array.isArray(raw)) return defaulted;
    return defaulted.map((value, index) => overlayRawConfig(value, raw[index]));
  }
  if (defaulted && typeof defaulted === "object") {
    const rawRecord = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(defaulted as Record<string, unknown>)) {
      result[key] = key in rawRecord ? overlayRawConfig(value, rawRecord[key]) : value;
    }
    return result;
  }
  return raw === undefined ? defaulted : raw;
}

export { configSchema, type OmniMcpConfig } from "./schema.js";
export { resolveEnvVariables, formatEnvErrors } from "./env.js";
