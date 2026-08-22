import { configSchema, type OmniMcpConfig } from "./schema.js";
import type { ValidationError, ValidationWarning } from "./loader.js";

export interface ValidateConfigResult {
  config?: OmniMcpConfig;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

/**
 * Schema + cross-field validation for an in-memory config object.
 */
export function validateConfig(input: unknown): ValidateConfigResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const parseResult = configSchema.safeParse(input);
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

  return { config, errors, warnings };
}

export function collectCrossFieldIssues(
  config: OmniMcpConfig,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  for (const [profileName, profile] of Object.entries(config.profiles)) {
    for (const serverName of profile.allow) {
      if (serverName !== "*" && !(serverName in config.servers)) {
        errors.push({
          message: `profiles.${profileName}.allow: unknown server "${serverName}"`,
        });
      }
    }
  }

  for (const [tokenName, token] of Object.entries(config.tokens)) {
    if (!(token.profile in config.profiles)) {
      errors.push({
        message: `tokens.${tokenName}.profile: unknown profile "${token.profile}"`,
      });
    }
  }

  if (!(config.defaultProfile in config.profiles)) {
    errors.push({
      message: `defaultProfile: unknown profile "${config.defaultProfile}"`,
    });
  }

  const usedProfiles = new Set(Object.values(config.tokens).map((t) => t.profile));
  usedProfiles.add(config.defaultProfile);
  for (const profileName of Object.keys(config.profiles)) {
    if (!usedProfiles.has(profileName)) {
      warnings.push({
        message: `Profile "${profileName}" is defined but no token maps to it`,
      });
    }
  }

  const usedServers = new Set<string>();
  for (const profile of Object.values(config.profiles)) {
    if (profile.allow.includes("*")) {
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
}
