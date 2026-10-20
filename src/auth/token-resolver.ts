import type { OmniMcpConfig, ProfileConfig, TokenConfig } from "../config/index.js";

export interface TokenResolutionResult {
  profile: string;
  profileConfig: ProfileConfig;
  tokenName: string | null;
  status: "authenticated" | "fallback" | "rejected";
  reason?: string;
}

/**
 * Resolves an incoming token to a profile based on config rules.
 * Implements the precedence rules from spec 02-token-auth.md.
 */
export function resolveToken(
  authHeader: string | undefined | null,
  config: OmniMcpConfig,
): TokenResolutionResult {
  const tokenName = extractTokenFromHeader(authHeader);
  const policy = config.security.unknownTokenPolicy;

  // No token provided
  if (tokenName === null) {
    if (policy === "reject") {
      return {
        profile: "",
        profileConfig: { allow: [], denyTools: {} },
        tokenName: null,
        status: "rejected",
        reason: "no_token",
      };
    }
    return fallbackToDefault(config);
  }

  // Known token
  const tokenConfig = config.tokens[tokenName];
  if (tokenConfig) {
    // Check if disabled
    if (tokenConfig.disabled) {
      return {
        profile: "",
        profileConfig: { allow: [], denyTools: {} },
        tokenName,
        status: "rejected",
        reason: "token_disabled",
      };
    }

    const profileNames = getTokenProfiles(tokenConfig);
    const profileConfigs = profileNames
      .map((name) => config.profiles[name])
      .filter((profile): profile is ProfileConfig => profile !== undefined);
    if (profileConfigs.length !== profileNames.length) {
      // Profile doesn't exist (shouldn't happen with valid config)
      return fallbackToDefault(config);
    }

    return {
      profile: [...profileNames].sort().join("+"),
      profileConfig: mergeProfiles(profileConfigs, Object.keys(config.servers)),
      tokenName,
      status: "authenticated",
    };
  }

  // Unknown token
  if (policy === "reject") {
    return {
      profile: "",
      profileConfig: { allow: [], denyTools: {} },
      tokenName,
      status: "rejected",
      reason: "unknown_token",
    };
  }

  return fallbackToDefault(config);
}

/**
 * Given a resolved profile, determines if a server is accessible.
 */
export function isServerAllowed(
  serverName: string,
  profileConfig: ProfileConfig,
): boolean {
  if (profileConfig.allow.includes("*")) {
    return true;
  }
  return profileConfig.allow.includes(serverName);
}

/**
 * Returns the list of allowed server names for a profile.
 */
export function getAllowedServers(
  profileConfig: ProfileConfig,
  allServerNames: string[],
): string[] {
  if (profileConfig.allow.includes("*")) {
    return allServerNames;
  }
  return profileConfig.allow.filter((name) => allServerNames.includes(name));
}

export function isToolAllowed(
  serverName: string,
  toolName: string,
  profileConfig: ProfileConfig,
): boolean {
  return isServerAllowed(serverName, profileConfig) &&
    !(profileConfig.denyTools?.[serverName] ?? []).includes(toolName);
}

export function getTokenProfiles(token: TokenConfig): string[] {
  return [...new Set(token.profiles ?? (token.profile ? [token.profile] : []))];
}

function mergeProfiles(
  profiles: ProfileConfig[],
  allServerNames: string[],
): ProfileConfig {
  const allow = profiles.some((profile) => profile.allow.includes("*"))
    ? ["*"]
    : [...new Set(profiles.flatMap((profile) => profile.allow))];
  const denyTools: Record<string, string[]> = {};

  for (const serverName of allServerNames) {
    const grantingProfiles = profiles.filter((profile) => isServerAllowed(serverName, profile));
    if (grantingProfiles.length === 0) continue;
    const [first, ...rest] = grantingProfiles;
    const deniedByEveryGrant = new Set(first?.denyTools?.[serverName] ?? []);
    for (const profile of rest) {
      const denied = new Set(profile.denyTools?.[serverName] ?? []);
      for (const toolName of deniedByEveryGrant) {
        if (!denied.has(toolName)) deniedByEveryGrant.delete(toolName);
      }
    }
    if (deniedByEveryGrant.size > 0) {
      denyTools[serverName] = [...deniedByEveryGrant];
    }
  }

  return { allow, denyTools };
}

function fallbackToDefault(config: OmniMcpConfig): TokenResolutionResult {
  // Try the default Token's profiles first
  const defaultToken = config.tokens["default"];
  if (defaultToken) {
    const profileNames = getTokenProfiles(defaultToken);
    const profileConfigs = profileNames
      .map((name) => config.profiles[name])
      .filter((profile): profile is ProfileConfig => profile !== undefined);
    if (profileConfigs.length === profileNames.length && profileConfigs.length > 0) {
      return {
        profile: [...profileNames].sort().join("+"),
        profileConfig: mergeProfiles(profileConfigs, Object.keys(config.servers)),
        tokenName: "default",
        status: "fallback",
      };
    }
  }

  // Fallback to defaultProfile config setting
  const profileConfig = config.profiles[config.defaultProfile];
  if (profileConfig) {
    return {
      profile: config.defaultProfile,
      profileConfig,
      tokenName: null,
      status: "fallback",
    };
  }

  // Final fallback: "default" profile
  const defaultProfile = config.profiles["default"];
  return {
    profile: "default",
    profileConfig: defaultProfile ?? { allow: [], denyTools: {} },
    tokenName: null,
    status: "fallback",
  };
}

function extractTokenFromHeader(
  header: string | undefined | null,
): string | null {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  // Also accept plain token value
  if (parts.length === 1 && parts[0].length > 0) {
    return parts[0];
  }
  return null;
}
