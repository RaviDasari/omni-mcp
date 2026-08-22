import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { configSchema, type OmniMcpConfig } from "./schema.js";
import { resolveEnvVariables } from "./env.js";
import { DEFAULT_CONFIG_PATH } from "../cli/config-path.js";
import { collectCrossFieldIssues } from "./validate.js";
import { createSecretStore, type SecretStoreOptions } from "./secret-store.js";

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
}

export interface ResolveConfigOptions extends SecretStoreOptions {
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
    return { errors, warnings };
  }

  // Parse JSON
  let rawConfig: Record<string, unknown>;
  try {
    const content = readFileSync(resolvedPath, "utf-8");
    rawConfig = JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown parse error";
    errors.push({ message: `Failed to parse config file: ${message}` });
    return { errors, warnings };
  }

  return resolveConfig(rawConfig, { env });
}

export function resolveConfig(
  rawConfig: Record<string, unknown>,
  options: ResolveConfigOptions = {},
): LoadConfigResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const storeConfigResult = configSchema.shape.secretStore.safeParse(rawConfig.secretStore);
  const storeConfig = storeConfigResult.success
    ? storeConfigResult.data
    : { backend: "file" as const, keychainService: "omni-mcp" as const };

  let resolved: Record<string, unknown>;
  try {
    const store = createSecretStore(storeConfig, options);
    const result = resolveEnvVariables(rawConfig, options.env ?? process.env, store);
    resolved = result.resolved;
    for (const envErr of result.errors) {
      errors.push({
        message: `${envErr.path}: neither the process environment nor the active secret store defines "${envErr.variable}"`,
      });
    }
  } catch (error) {
    errors.push({
      message: error instanceof Error ? error.message : "Failed to access the active secret store",
    });
    return { errors, warnings };
  }

  if (errors.length > 0) return { errors, warnings };

  // Schema validation
  const parseResult = configSchema.safeParse(resolved);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      const path = issue.path.join(".");
      errors.push({ message: `${path}: ${issue.message}` });
    }
    return { errors, warnings };
  }

  const config = parseResult.data;
  collectCrossFieldIssues(config, errors, warnings);

  if (errors.length > 0) {
    return { errors, warnings };
  }

  return {
    config,
    rawConfig: overlayRawConfig(config, rawConfig) as OmniMcpConfig,
    errors,
    warnings,
  };
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
