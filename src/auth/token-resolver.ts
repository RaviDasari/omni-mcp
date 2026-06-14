import type { OmniMcpConfig, ProfileConfig } from "../config/index.js";

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
        profileConfig: { allow: [] },
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
        profileConfig: { allow: [] },
        tokenName,
        status: "rejected",
        reason: "token_disabled",
      };
    }

    const profileConfig = config.profiles[tokenConfig.profile];
    if (!profileConfig) {
      // Profile doesn't exist (shouldn't happen with valid config)
      return fallbackToDefault(config);
    }

    return {
      profile: tokenConfig.profile,
      profileConfig,
      tokenName,
      status: "authenticated",
    };
  }

  // Unknown token
  if (policy === "reject") {
    return {
      profile: "",
      profileConfig: { allow: [] },
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

function fallbackToDefault(config: OmniMcpConfig): TokenResolutionResult {
  // Try default token's profile first
  const defaultToken = config.tokens["default"];
  if (defaultToken) {
    const profileConfig = config.profiles[defaultToken.profile];
    if (profileConfig) {
      return {
        profile: defaultToken.profile,
        profileConfig,
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
    profileConfig: defaultProfile ?? { allow: [] },
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
