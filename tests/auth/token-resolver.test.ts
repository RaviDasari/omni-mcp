import { describe, it, expect } from "vitest";
import {
  resolveToken,
  isServerAllowed,
  getAllowedServers,
} from "../../src/auth/token-resolver.js";
import type { OmniMcpConfig } from "../../src/config/schema.js";

function makeConfig(overrides: Partial<OmniMcpConfig> = {}): OmniMcpConfig {
  return {
    port: 6317,
    host: "127.0.0.1",
    defaultProfile: "default",
    shutdownGracePeriodMs: 10000,
    servers: {
      filesystem: { type: "stdio", command: "echo", args: [], maxRestarts: 3, restartBackoffMs: 1000, callTimeoutMs: 60000, hangThreshold: 3 },
      github: { type: "stdio", command: "echo", args: [], maxRestarts: 3, restartBackoffMs: 1000, callTimeoutMs: 60000, hangThreshold: 3 },
      "prod-db": { type: "http", url: "https://example.com/mcp", timeoutMs: 30000, retries: 2, retryBackoffMs: 500, reconnectIntervalMs: 30000 },
    },
    profiles: {
      default: { allow: ["filesystem"] },
      "safe-coding": { allow: ["filesystem", "github"] },
      admin: { allow: ["*"] },
    },
    tokens: {
      default: { profile: "safe-coding", disabled: false },
      cursor: { profile: "admin", disabled: false },
      claude: { profile: "safe-coding", disabled: false },
      disabled: { profile: "admin", disabled: true },
    },
    security: { unknownTokenPolicy: "fallback-to-default" },
    trafficLog: { enabled: true, retentionDays: 7, maxBytes: 5242880 },
    ...overrides,
  };
}

function bearerHeader(token: string): string {
  return ["Bearer", token].join(" ");
}

describe("Token Resolution", () => {
  describe("resolveToken", () => {
    it("resolves a known token to its profile", () => {
      const config = makeConfig();
      const result = resolveToken(bearerHeader("cursor"), config);

      expect(result.status).toBe("authenticated");
      expect(result.profile).toBe("admin");
      expect(result.tokenName).toBe("cursor");
      expect(result.profileConfig.allow).toEqual(["*"]);
    });

    it("resolves default token", () => {
      const config = makeConfig();
      const result = resolveToken(bearerHeader("default"), config);

      expect(result.status).toBe("authenticated");
      expect(result.profile).toBe("safe-coding");
    });

    it("falls back to default for unknown token with fallback policy", () => {
      const config = makeConfig();
      const result = resolveToken(bearerHeader("unknown-agent"), config);

      expect(result.status).toBe("fallback");
      expect(result.profile).toBe("safe-coding"); // default token's profile
    });

    it("rejects unknown token with reject policy", () => {
      const config = makeConfig({ security: { unknownTokenPolicy: "reject" } });
      const result = resolveToken(bearerHeader("unknown-agent"), config);

      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("unknown_token");
    });

    it("falls back to default when no token provided with fallback policy", () => {
      const config = makeConfig();
      const result = resolveToken(undefined, config);

      expect(result.status).toBe("fallback");
      expect(result.profile).toBe("safe-coding");
    });

    it("rejects when no token provided with reject policy", () => {
      const config = makeConfig({ security: { unknownTokenPolicy: "reject" } });
      const result = resolveToken(undefined, config);

      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("no_token");
    });

    it("rejects disabled tokens", () => {
      const config = makeConfig();
      const result = resolveToken(bearerHeader("disabled"), config);

      expect(result.status).toBe("rejected");
      expect(result.reason).toBe("token_disabled");
    });

    it("handles null authorization header", () => {
      const config = makeConfig();
      const result = resolveToken(null, config);

      expect(result.status).toBe("fallback");
    });

    it("handles empty authorization header", () => {
      const config = makeConfig();
      const result = resolveToken("", config);

      expect(result.status).toBe("fallback");
    });

    it("accepts plain token without ******", () => {
      const config = makeConfig();
      const result = resolveToken("cursor", config);

      expect(result.status).toBe("authenticated");
      expect(result.profile).toBe("admin");
    });
  });

  describe("isServerAllowed", () => {
    it("allows any server with wildcard", () => {
      expect(isServerAllowed("anything", { allow: ["*"] })).toBe(true);
    });

    it("allows explicitly listed servers", () => {
      expect(isServerAllowed("filesystem", { allow: ["filesystem", "github"] })).toBe(true);
    });

    it("denies unlisted servers", () => {
      expect(isServerAllowed("prod-db", { allow: ["filesystem", "github"] })).toBe(false);
    });
  });

  describe("getAllowedServers", () => {
    it("returns all servers for wildcard", () => {
      const result = getAllowedServers(
        { allow: ["*"] },
        ["filesystem", "github", "prod-db"],
      );
      expect(result).toEqual(["filesystem", "github", "prod-db"]);
    });

    it("returns only listed servers that exist", () => {
      const result = getAllowedServers(
        { allow: ["filesystem", "github", "nonexistent"] },
        ["filesystem", "github", "prod-db"],
      );
      expect(result).toEqual(["filesystem", "github"]);
    });

    it("returns empty for no matching servers", () => {
      const result = getAllowedServers(
        { allow: ["nonexistent"] },
        ["filesystem", "github"],
      );
      expect(result).toEqual([]);
    });
  });
});
