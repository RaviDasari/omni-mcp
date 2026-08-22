import { describe, it, expect } from "vitest";
import { configSchema } from "../../src/config/schema.js";

describe("Config Schema", () => {
  describe("valid configs", () => {
    it("accepts a minimal valid config", () => {
      const result = configSchema.safeParse({
        servers: {
          filesystem: {
            type: "stdio",
            command: "echo",
            args: ["hello"],
          },
        },
        profiles: {
          default: { allow: ["*"] },
        },
        tokens: {
          default: { profile: "default" },
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(6317);
        expect(result.data.host).toBe("127.0.0.1");
        expect(result.data.defaultProfile).toBe("default");
        expect(result.data.trafficLog).toEqual({
          enabled: true,
          retentionDays: 7,
          maxBytes: 5242880,
        });
        expect(result.data.servers.filesystem.cli).toEqual({ enabled: false });
      }
    });

    it("accepts a full config with all options", () => {
      const result = configSchema.safeParse({
        port: 8080,
        host: "0.0.0.0",
        defaultProfile: "safe-coding",
        shutdownGracePeriodMs: 5000,
        servers: {
          filesystem: {
            type: "stdio",
            cli: { enabled: true },
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/docs"],
            maxRestarts: 5,
            restartBackoffMs: 2000,
            callTimeoutMs: 30000,
            hangThreshold: 5,
            cwd: "/home/user",
            env: { MY_VAR: "value" },
          },
          "remote-api": {
            type: "http",
            url: "https://api.example.com/mcp",
            auth: { type: "jwt", token: "my-jwt-token" },
            timeoutMs: 10000,
            retries: 3,
            retryBackoffMs: 1000,
            reconnectIntervalMs: 60000,
          },
        },
        profiles: {
          default: { allow: ["filesystem"] },
          admin: { allow: ["*"] },
        },
        tokens: {
          default: { profile: "default", description: "Fallback" },
          cursor: { profile: "admin", description: "Cursor IDE", disabled: false },
        },
        security: {
          unknownTokenPolicy: "reject",
        },
        trafficLog: {
          enabled: false,
          retentionDays: 14,
          maxBytes: 1048576,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(8080);
        expect(result.data.host).toBe("0.0.0.0");
        expect(result.data.security.unknownTokenPolicy).toBe("reject");
        expect(result.data.trafficLog.retentionDays).toBe(14);
        expect(result.data.servers.filesystem.cli.enabled).toBe(true);
      }
    });

    it("applies defaults for optional fields", () => {
      const result = configSchema.safeParse({
        servers: {
          test: { type: "stdio", command: "test" },
        },
        profiles: { default: { allow: ["*"] } },
        tokens: { default: { profile: "default" } },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const server = result.data.servers["test"];
        expect(server.type).toBe("stdio");
        if (server.type === "stdio") {
          expect(server.maxRestarts).toBe(3);
          expect(server.restartBackoffMs).toBe(1000);
          expect(server.callTimeoutMs).toBe(60000);
          expect(server.hangThreshold).toBe(3);
          expect(server.args).toEqual([]);
        }
      }
    });
  });

  describe("invalid configs", () => {
    it("rejects config with no servers", () => {
      const result = configSchema.safeParse({
        servers: {},
        profiles: { default: { allow: ["*"] } },
        tokens: { default: { profile: "default" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects config without default profile", () => {
      const result = configSchema.safeParse({
        servers: { test: { type: "stdio", command: "x" } },
        profiles: { admin: { allow: ["*"] } },
        tokens: { default: { profile: "admin" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects config without default token", () => {
      const result = configSchema.safeParse({
        servers: { test: { type: "stdio", command: "x" } },
        profiles: { default: { allow: ["*"] } },
        tokens: { cursor: { profile: "default" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects stdio server without command", () => {
      const result = configSchema.safeParse({
        servers: { test: { type: "stdio" } },
        profiles: { default: { allow: ["*"] } },
        tokens: { default: { profile: "default" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects http server without url", () => {
      const result = configSchema.safeParse({
        servers: { test: { type: "http" } },
        profiles: { default: { allow: ["*"] } },
        tokens: { default: { profile: "default" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects http server with invalid url", () => {
      const result = configSchema.safeParse({
        servers: { test: { type: "http", url: "not-a-url" } },
        profiles: { default: { allow: ["*"] } },
        tokens: { default: { profile: "default" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects empty allow list in profile", () => {
      const result = configSchema.safeParse({
        servers: { test: { type: "stdio", command: "x" } },
        profiles: { default: { allow: [] } },
        tokens: { default: { profile: "default" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects invalid port values", () => {
      const result = configSchema.safeParse({
        port: 99999,
        servers: { test: { type: "stdio", command: "x" } },
        profiles: { default: { allow: ["*"] } },
        tokens: { default: { profile: "default" } },
      });

      expect(result.success).toBe(false);
    });

    it("rejects invalid unknownTokenPolicy", () => {
      const result = configSchema.safeParse({
        servers: { test: { type: "stdio", command: "x" } },
        profiles: { default: { allow: ["*"] } },
        tokens: { default: { profile: "default" } },
        security: { unknownTokenPolicy: "invalid" },
      });

      expect(result.success).toBe(false);
    });
  });
});
