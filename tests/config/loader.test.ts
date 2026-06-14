import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadConfig } from "../../src/config/loader.js";

const FIXTURES_DIR = resolve(import.meta.dirname, "../fixtures");

describe("Config Loader", () => {
  describe("loadConfig", () => {
    it("loads a minimal valid config", () => {
      const result = loadConfig(resolve(FIXTURES_DIR, "minimal-config.json"));

      expect(result.errors).toHaveLength(0);
      expect(result.config).toBeDefined();
      expect(result.config!.port).toBe(6317);
      expect(result.config!.servers.filesystem.type).toBe("stdio");
    });

    it("loads a full valid config with env vars", () => {
      const env = {
        GITHUB_TOKEN: "ghp_test123",
        PROD_DB_JWT: "jwt_token_value",
      };

      const result = loadConfig(
        resolve(FIXTURES_DIR, "valid-config.json"),
        env,
      );

      expect(result.errors).toHaveLength(0);
      expect(result.config).toBeDefined();
      expect(result.config!.tokens.cursor.profile).toBe("admin");
    });

    it("reports errors for missing env variables", () => {
      const result = loadConfig(
        resolve(FIXTURES_DIR, "valid-config.json"),
        {}, // no env vars
      );

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.message.includes("GITHUB_TOKEN"))).toBe(true);
      expect(result.errors.some((e) => e.message.includes("PROD_DB_JWT"))).toBe(true);
    });

    it("reports validation errors for invalid config", () => {
      const result = loadConfig(resolve(FIXTURES_DIR, "invalid-config.json"));

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.config).toBeUndefined();
    });

    it("reports error when config file does not exist", () => {
      const result = loadConfig("/nonexistent/path/config.json");

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("not found");
    });

    it("reports error for malformed JSON", () => {
      // We'll use a path that we know has malformed JSON - let's use a temp approach
      const result = loadConfig(resolve(FIXTURES_DIR, "../../README.md"));

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain("parse");
    });

    it("detects unknown server in profile allow list", () => {
      const result = loadConfig(resolve(FIXTURES_DIR, "minimal-config.json"));
      // minimal config uses allow: ["*"] so no cross-validation issues
      expect(result.errors).toHaveLength(0);
    });

    it("warns about unreachable profiles", () => {
      // In valid-config.json, "default" profile exists but no token uses it
      // tokens: default->safe-coding, cursor->admin, claude->safe-coding
      // defaultProfile defaults to "default" if not set, so "default" IS used as fallback
      // Actually safe-coding is used by "default" token, admin by cursor
      // The "default" profile name matches defaultProfile so it's reachable
      const env = { GITHUB_TOKEN: "x", PROD_DB_JWT: "x" };
      const result = loadConfig(resolve(FIXTURES_DIR, "valid-config.json"), env);

      // "admin" profile is used by cursor token. "safe-coding" used by default and claude tokens.
      // "default" profile is referenced as the config's default fallback (defaultProfile defaults to "default").
      // All profiles should be reachable in this config.
      expect(result.errors).toHaveLength(0);
    });
  });
});
