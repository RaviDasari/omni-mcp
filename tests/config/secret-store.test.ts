import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnSyncReturns } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileSecretStore,
  KeychainSecretStore,
  migrateSecretStore,
  type SecretStore,
} from "../../src/config/secret-store.js";

const tempDirs: string[] = [];

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "omni-secrets-"));
  tempDirs.push(dir);
  return join(dir, "nested", "secrets.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("FileSecretStore", () => {
  it("creates, lists, reads, updates, and deletes secrets with 0600 permissions", () => {
    const path = tempPath();
    const store = new FileSecretStore(path);

    expect(store.list()).toEqual([]);
    store.set("BETA", "two");
    store.set("ALPHA", "one");
    store.set("ALPHA", "updated");

    expect(store.list()).toEqual(["ALPHA", "BETA"]);
    expect(store.get("ALPHA")).toBe("updated");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ BETA: "two", ALPHA: "updated" });
    expect(statSync(join(path, "..")).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(store.delete("ALPHA")).toBe(true);
    expect(store.delete("ALPHA")).toBe(false);
    expect(store.get("ALPHA")).toBeUndefined();
  });

  it("rejects malformed files without overwriting them", () => {
    const path = tempPath();
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{not json");
    const store = new FileSecretStore(path);

    expect(() => store.list()).toThrow(/Failed to parse secrets file/);
    expect(readFileSync(path, "utf8")).toBe("{not json");
  });
});

describe("KeychainSecretStore", () => {
  it("uses the injected security runner for CRUD and maintains its index", () => {
    const values = new Map<string, string>();
    const runSecurity = vi.fn((args: string[]) => {
      const account = args[args.indexOf("-a") + 1]!;
      if (args[0] === "find-generic-password") {
        const value = values.get(account);
        return result(value === undefined ? 44 : 0, value ?? "");
      }
      if (args[0] === "add-generic-password") {
        values.set(account, args[args.indexOf("-w") + 1]!);
        return result(0);
      }
      values.delete(account);
      return result(0);
    });
    const store = new KeychainSecretStore("test-service", {
      platform: "darwin",
      runSecurity,
    });

    store.set("TOKEN", "secret");
    expect(store.get("TOKEN")).toBe("secret");
    expect(store.list()).toEqual(["TOKEN"]);
    expect(store.delete("TOKEN")).toBe(true);
    expect(store.get("TOKEN")).toBeUndefined();
    values.set("api-token@example.com", "external");
    expect(store.readAccount("api-token@example.com")).toBe("external");
    expect(runSecurity).toHaveBeenCalledWith([
      "add-generic-password", "-U", "-s", "test-service", "-a", "TOKEN", "-w", "secret",
    ]);
  });

  it("rejects keychain use on other platforms", () => {
    expect(() => new KeychainSecretStore("test", { platform: "linux" })).toThrow(
      /only available on macOS/,
    );
  });
});

describe("migrateSecretStore", () => {
  it("rolls back destination writes and leaves the source intact when migration fails", () => {
    const sourceValues = new Map([["A", "one"], ["B", "two"]]);
    const destinationValues = new Map<string, string>();
    const source = memoryStore(sourceValues);
    const destination = memoryStore(destinationValues, "B");

    expect(() => migrateSecretStore(source, destination)).toThrow("write failed");
    expect([...sourceValues]).toEqual([["A", "one"], ["B", "two"]]);
    expect([...destinationValues]).toEqual([]);
  });
});

function result(status: number, stdout = "", stderr = ""): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout, stderr, status, signal: null };
}

function memoryStore(values: Map<string, string>, failOnSet?: string): SecretStore {
  return {
    backend: "file",
    list: () => [...values.keys()],
    get: (name) => values.get(name),
    set: (name, value) => {
      if (name === failOnSet) throw new Error("write failed");
      values.set(name, value);
    },
    delete: (name) => values.delete(name),
  };
}
