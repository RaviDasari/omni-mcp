import { describe, expect, it } from "vitest";
import {
  cliInlineCandidates,
  inlineConflicts,
  parseRenames,
} from "../../src/cli/commands/secrets.js";
import type { OmniMcpConfig } from "../../src/config/schema.js";

function config(): OmniMcpConfig {
  return {
    port: 6317,
    host: "127.0.0.1",
    defaultProfile: "default",
    shutdownGracePeriodMs: 10000,
    servers: {
      jira: {
        type: "stdio",
        enabled: true,
        cli: { enabled: false },
        command: "jira-mcp",
        args: [],
        env: { JIRA_TOKEN: "literal", EXISTING_REF: "$OTHER" },
        maxRestarts: 3,
        restartBackoffMs: 1000,
        callTimeoutMs: 60000,
        hangThreshold: 3,
      },
      "prod-api": {
        type: "http",
        enabled: true,
        cli: { enabled: false },
        url: "https://example.com/mcp",
        auth: { type: "jwt", token: "jwt-literal" },
        timeoutMs: 30000,
        retries: 2,
        retryBackoffMs: 500,
        reconnectIntervalMs: 30000,
      },
    },
    profiles: { default: { allow: ["*"] } },
    tokens: { default: { profile: "default", disabled: false } },
    security: { unknownTokenPolicy: "fallback-to-default" },
    trafficLog: { enabled: true, retentionDays: 7, maxBytes: 5242880 },
    secretStore: { backend: "file", keychainService: "omni-mcp" },
  };
}

describe("secrets CLI migration helpers", () => {
  it("previews literal env and JWT fields but skips existing references", () => {
    const candidates = cliInlineCandidates(config());
    expect(candidates.map(({ name, path }) => ({ name, path }))).toEqual([
      { name: "JIRA_TOKEN", path: "servers.jira.env.JIRA_TOKEN" },
      { name: "PROD_API_TOKEN", path: "servers.prod-api.auth.token" },
    ]);
  });

  it("applies and validates explicit rename mappings", () => {
    expect(parseRenames(["JIRA_TOKEN=JIRA_API_TOKEN"])).toEqual({
      JIRA_TOKEN: "JIRA_API_TOKEN",
    });
    expect(() => parseRenames(["bad"])).toThrow(/NAME=NEW_NAME/);
    expect(() => parseRenames(["JIRA_TOKEN=bad-name"])).toThrow(/Invalid secret name/);

    const raw = config();
    const [candidate] = cliInlineCandidates(raw);
    candidate!.apply("JIRA_API_TOKEN");
    const jira = raw.servers.jira;
    expect(jira.type === "stdio" && jira.env?.JIRA_TOKEN).toBe("$JIRA_API_TOKEN");
  });

  it("detects candidate and existing-store value conflicts", () => {
    const candidates = cliInlineCandidates(config());
    expect(inlineConflicts(candidates, {
      get: (name) => name === "JIRA_TOKEN" ? "different" : undefined,
    })).toEqual(["JIRA_TOKEN"]);
  });
});

