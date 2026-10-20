import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSecretStore } from "../../src/config/secret-store.js";
import { VariableStore } from "../../src/config/variable-store.js";

describe("VariableStore", () => {
  let dir: string;
  let secrets: FileSecretStore;
  let variables: VariableStore;
  let catalogPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-mcp-variables-"));
    catalogPath = join(dir, "variables.json");
    secrets = new FileSecretStore(join(dir, "secrets.json"));
    variables = new VariableStore(secrets, { variablesFilePath: catalogPath });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores plain values in variables.json and returns them", () => {
    variables.set("API_URL", "https://example.test", "plain");

    expect(variables.get("API_URL")).toBe("https://example.test");
    expect(variables.list()).toContainEqual({
      name: "API_URL",
      type: "plain",
      set: true,
      value: "https://example.test",
    });
    expect(readFileSync(catalogPath, "utf8")).toContain("https://example.test");
    expect(secrets.get("API_URL")).toBeUndefined();
  });

  it("keeps secret values out of variables.json", () => {
    variables.set("API_TOKEN", "classified", "secret");

    expect(variables.get("API_TOKEN")).toBe("classified");
    expect(variables.list()).toContainEqual({
      name: "API_TOKEN",
      type: "secret",
      set: true,
    });
    expect(readFileSync(catalogPath, "utf8")).not.toContain("classified");
  });

  it("infers existing backend-only values as secret", () => {
    secrets.set("LEGACY_VALUE", "secret-value");

    expect(variables.getType("LEGACY_VALUE")).toBe("secret");
    expect(variables.list()).toContainEqual({
      name: "LEGACY_VALUE",
      type: "secret",
      set: true,
    });
  });

  it("converts values in both directions without retaining the old copy", () => {
    variables.set("MOVABLE", "value", "secret");
    variables.convert("MOVABLE", "plain");

    expect(variables.getType("MOVABLE")).toBe("plain");
    expect(variables.get("MOVABLE")).toBe("value");
    expect(secrets.get("MOVABLE")).toBeUndefined();

    variables.convert("MOVABLE", "secret");
    expect(variables.getType("MOVABLE")).toBe("secret");
    expect(secrets.get("MOVABLE")).toBe("value");
    expect(readFileSync(catalogPath, "utf8")).not.toContain('"value"');
  });

  it("requires explicit conversion when replacing with another type", () => {
    variables.set("MODE", "development", "plain");
    expect(() => variables.set("MODE", "hidden", "secret")).toThrow("convert it to secret");
  });
});
