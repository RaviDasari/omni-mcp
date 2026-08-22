import { describe, it, expect, vi } from "vitest";
import { resolveEnvVariables, formatEnvErrors } from "../../src/config/env.js";

describe("Environment Variable Resolution", () => {
  describe("resolveEnvVariables", () => {
    it("resolves $VAR_NAME to environment value", () => {
      const config = {
        servers: {
          api: {
            auth: { token: "$MY_TOKEN" },
          },
        },
      };
      const env = { MY_TOKEN: "secret123" };

      const { resolved, errors } = resolveEnvVariables(config, env);
      expect(errors).toHaveLength(0);
      expect((resolved as any).servers.api.auth.token).toBe("secret123");
    });

    it("resolves both exact reference syntaxes from the secret store", () => {
      const secrets = { get: (name: string) => ({ TOKEN: "stored" })[name] };
      const { resolved, errors } = resolveEnvVariables(
        { bare: "$TOKEN", braced: "${TOKEN}" },
        {},
        secrets,
      );

      expect(errors).toEqual([]);
      expect(resolved).toEqual({ bare: "stored", braced: "stored" });
    });

    it("prefers a non-empty process environment value over the secret store", () => {
      const secrets = { get: vi.fn(() => "stored") };
      const { resolved } = resolveEnvVariables({ value: "$TOKEN" }, { TOKEN: "environment" }, secrets);

      expect(resolved.value).toBe("environment");
      expect(secrets.get).not.toHaveBeenCalled();
    });

    it("does not expand references embedded in strings", () => {
      const config = { prefix: "Bearer $TOKEN", suffix: "${TOKEN}/path" };
      const { resolved, errors } = resolveEnvVariables(config, { TOKEN: "secret" });

      expect(errors).toEqual([]);
      expect(resolved).toEqual(config);
    });

    it("reports error for missing env variable", () => {
      const config = {
        auth: { token: "$MISSING_VAR" },
      };
      const env = {};

      const { resolved, errors } = resolveEnvVariables(config, env);
      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe("auth.token");
      expect(errors[0].variable).toBe("MISSING_VAR");
    });

    it("reports error for empty env variable", () => {
      const config = { key: "$EMPTY_VAR" };
      const env = { EMPTY_VAR: "" };

      const { errors } = resolveEnvVariables(config, env);
      expect(errors).toHaveLength(1);
      expect(errors[0].variable).toBe("EMPTY_VAR");
    });

    it("escapes $$ to a single $", () => {
      const config = { value: "$$LITERAL" };
      const env = {};

      const { resolved, errors } = resolveEnvVariables(config, env);
      expect(errors).toHaveLength(0);
      expect((resolved as any).value).toBe("$LITERAL");
    });

    it("preserves non-$ strings unchanged", () => {
      const config = {
        port: 6317,
        name: "hello world",
        nested: { items: ["a", "b"] },
      };
      const env = {};

      const { resolved, errors } = resolveEnvVariables(config, env);
      expect(errors).toHaveLength(0);
      expect(resolved).toEqual(config);
    });

    it("resolves multiple variables in nested objects", () => {
      const config = {
        servers: {
          a: { env: { KEY1: "$VAR1", KEY2: "$VAR2" } },
          b: { token: "$VAR3" },
        },
      };
      const env = { VAR1: "val1", VAR2: "val2", VAR3: "val3" };

      const { resolved, errors } = resolveEnvVariables(config, env);
      expect(errors).toHaveLength(0);
      expect((resolved as any).servers.a.env.KEY1).toBe("val1");
      expect((resolved as any).servers.a.env.KEY2).toBe("val2");
      expect((resolved as any).servers.b.token).toBe("val3");
    });

    it("handles arrays with env variables", () => {
      const config = { items: ["$VAR1", "plain", "$VAR2"] };
      const env = { VAR1: "a", VAR2: "b" };

      const { resolved, errors } = resolveEnvVariables(config, env);
      expect(errors).toHaveLength(0);
      expect((resolved as any).items).toEqual(["a", "plain", "b"]);
    });

    it("collects all errors (not fail-fast)", () => {
      const config = {
        a: "$MISSING1",
        b: "$MISSING2",
        c: { d: "$MISSING3" },
      };
      const env = {};

      const { errors } = resolveEnvVariables(config, env);
      expect(errors).toHaveLength(3);
    });
  });

  describe("formatEnvErrors", () => {
    it("formats errors into human-readable messages", () => {
      const errors = [
        { path: "servers.api.auth.token", variable: "MY_JWT" },
        { path: "servers.db.env.PASSWORD", variable: "DB_PASS" },
      ];

      const messages = formatEnvErrors(errors);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain("servers.api.auth.token");
      expect(messages[0]).toContain("MY_JWT");
      expect(messages[0]).toContain("not set");
    });
  });
});
