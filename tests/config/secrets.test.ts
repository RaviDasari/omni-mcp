import { describe, it, expect } from "vitest";
import {
  collectSecretUsages,
  mergeSecrets,
  redactConfig,
  REDACTED_SECRET,
} from "../../src/config/secrets.js";
import type { OmniMcpConfig } from "../../src/config/schema.js";

function sample(): OmniMcpConfig {
  return {
    port: 6317,
    host: "127.0.0.1",
    defaultProfile: "default",
    shutdownGracePeriodMs: 10000,
    servers: {
      github: {
        type: "stdio",
        command: "npx",
        args: [],
        maxRestarts: 3,
        restartBackoffMs: 1000,
        callTimeoutMs: 60000,
        hangThreshold: 3,
        env: { GITHUB_TOKEN: "secret-token" },
      },
      remote: {
        type: "http",
        url: "https://example.com/mcp",
        timeoutMs: 30000,
        retries: 2,
        retryBackoffMs: 500,
        reconnectIntervalMs: 30000,
        auth: { type: "jwt", token: "jwt-secret" },
      },
    },
    profiles: { default: { allow: ["*"] } },
    tokens: { default: { profile: "default", disabled: false } },
    security: { unknownTokenPolicy: "fallback-to-default" },
    trafficLog: { enabled: true, retentionDays: 7, maxBytes: 5242880 },
    secretStore: { backend: "file", keychainService: "omni-mcp" },
  };
}

describe("config secrets", () => {
  it("redacts env and http auth tokens", () => {
    const redacted = redactConfig(sample());
    const github = redacted.servers.github;
    const remote = redacted.servers.remote;
    expect(github.type === "stdio" && github.env?.GITHUB_TOKEN).toBe(REDACTED_SECRET);
    expect(remote.type === "http" && remote.auth?.token).toBe(REDACTED_SECRET);
  });

  it("preserves exact secret references while redacting literal values", () => {
    const config = sample();
    const github = config.servers.github;
    const remote = config.servers.remote;
    if (github.type === "stdio") github.env = { BARE: "$TOKEN", BRACED: "${OTHER}" };
    if (remote.type === "http") remote.auth = { type: "jwt", token: "prefix-$TOKEN" };

    const redacted = redactConfig(config);
    const redactedGithub = redacted.servers.github;
    const redactedRemote = redacted.servers.remote;
    expect(redactedGithub.type === "stdio" && redactedGithub.env).toEqual({
      BARE: "$TOKEN",
      BRACED: "${OTHER}",
    });
    expect(redactedRemote.type === "http" && redactedRemote.auth?.token).toBe(REDACTED_SECRET);
  });

  it("collects reference paths and owning servers", () => {
    const config = sample();
    const github = config.servers.github;
    const remote = config.servers.remote;
    if (github.type === "stdio") github.env = { TOKEN: "$SHARED" };
    if (remote.type === "http") remote.auth = { type: "jwt", token: "${SHARED}" };

    expect(collectSecretUsages(config).SHARED).toEqual([
      { path: "servers.github.env.TOKEN", server: "github" },
      { path: "servers.remote.auth.token", server: "remote" },
    ]);
  });

  it("restores secrets when the UI sends the placeholder", () => {
    const previous = sample();
    const incoming = redactConfig(previous);
    const merged = mergeSecrets(incoming, previous);
    const github = merged.servers.github;
    const remote = merged.servers.remote;
    expect(github.type === "stdio" && github.env?.GITHUB_TOKEN).toBe("secret-token");
    expect(remote.type === "http" && remote.auth?.token).toBe("jwt-secret");
  });
});
