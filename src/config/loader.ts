import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { configSchema, type OmniMcpConfig } from "./schema.js";
import { resolveEnvVariables, formatEnvErrors } from "./env.js";
import { DEFAULT_CONFIG_PATH } from "../cli/config-path.js";

export interface ValidationError {
  message: string;
}

export interface ValidationWarning {
  message: string;
}

export interface LoadConfigResult {
  config?: OmniMcpConfig;
  errors: ValidationError[];
  warnings: ValidationWarning[];
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

  // Resolve environment variables — missing vars are warnings, not errors.
  // Servers with unresolved vars will fail to connect; crash isolation handles the rest.
  const { resolved, errors: envErrors } = resolveEnvVariables(rawConfig, env);
  for (const envErr of envErrors) {
    warnings.push({
      message: `${envErr.path}: "$${envErr.variable}" is not set — server will be unavailable until the variable is exported`,
    });
  }

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

  // Cross-field validation: profile allow lists reference existing servers
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    for (const serverName of profile.allow) {
      if (serverName !== "*" && !(serverName in config.servers)) {
        errors.push({
          message: `profiles.${profileName}.allow: unknown server "${serverName}"`,
        });
      }
    }
  }

  // Cross-field validation: tokens reference existing profiles
  for (const [tokenName, token] of Object.entries(config.tokens)) {
    if (!(token.profile in config.profiles)) {
      errors.push({
        message: `tokens.${tokenName}.profile: unknown profile "${token.profile}"`,
      });
    }
  }

  // Cross-field validation: defaultProfile exists
  if (!(config.defaultProfile in config.profiles)) {
    errors.push({
      message: `defaultProfile: unknown profile "${config.defaultProfile}"`,
    });
  }

  // Warnings: unreachable profiles (no token maps to them)
  const usedProfiles = new Set(
    Object.values(config.tokens).map((t) => t.profile),
  );
  usedProfiles.add(config.defaultProfile);
  for (const profileName of Object.keys(config.profiles)) {
    if (!usedProfiles.has(profileName)) {
      warnings.push({
        message: `Profile "${profileName}" is defined but no token maps to it`,
      });
    }
  }

  // Warnings: unused servers (not in any profile)
  const usedServers = new Set<string>();
  for (const profile of Object.values(config.profiles)) {
    if (profile.allow.includes("*")) {
      // Wildcard means all servers are used
      for (const serverName of Object.keys(config.servers)) {
        usedServers.add(serverName);
      }
    } else {
      for (const s of profile.allow) {
        usedServers.add(s);
      }
    }
  }
  for (const serverName of Object.keys(config.servers)) {
    if (!usedServers.has(serverName)) {
      warnings.push({
        message: `Server "${serverName}" is defined but not included in any profile allow list`,
      });
    }
  }

  if (errors.length > 0) {
    return { errors, warnings };
  }

  return { config, errors, warnings };
}

export { configSchema, type OmniMcpConfig } from "./schema.js";
export { resolveEnvVariables, formatEnvErrors } from "./env.js";
