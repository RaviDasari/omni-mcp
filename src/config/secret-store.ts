import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { DEFAULT_SECRETS_PATH } from "../cli/config-path.js";
import type { SecretStoreConfig } from "./schema.js";

export const SECRET_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEYCHAIN_INDEX_ACCOUNT = "__omni_mcp_index__";

export interface SecretStore {
  readonly backend: "file" | "keychain";
  list(): string[];
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): boolean;
}

export interface SecretStoreOptions {
  filePath?: string;
  platform?: NodeJS.Platform;
  runSecurity?: (args: string[]) => SpawnSyncReturns<string>;
}

export function assertSecretName(name: string): void {
  if (!SECRET_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid secret name "${name}". Use letters, numbers, and underscores, starting with a letter or underscore.`,
    );
  }
}

export function createSecretStore(
  config: SecretStoreConfig,
  options: SecretStoreOptions = {},
): SecretStore {
  if (config.backend === "keychain") {
    return new KeychainSecretStore(config.keychainService, options);
  }
  return new FileSecretStore(options.filePath ?? DEFAULT_SECRETS_PATH);
}

export class FileSecretStore implements SecretStore {
  readonly backend = "file" as const;

  constructor(readonly path = DEFAULT_SECRETS_PATH) {}

  list(): string[] {
    return Object.keys(this.read()).sort();
  }

  get(name: string): string | undefined {
    assertSecretName(name);
    return this.read()[name];
  }

  set(name: string, value: string): void {
    assertSecretName(name);
    if (!value) throw new Error("Secret value must not be empty");
    const values = this.read();
    values[name] = value;
    this.write(values);
  }

  delete(name: string): boolean {
    assertSecretName(name);
    const values = this.read();
    if (!(name in values)) return false;
    delete values[name];
    this.write(values);
    return true;
  }

  private read(): Record<string, string> {
    if (!existsSync(this.path)) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      throw new Error(
        `Failed to parse secrets file ${this.path}: ${error instanceof Error ? error.message : "invalid JSON"}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Secrets file ${this.path} must contain a JSON object`);
    }
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed)) {
      assertSecretName(name);
      if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Secret "${name}" in ${this.path} must be a non-empty string`);
      }
      result[name] = value;
    }
    return result;
  }

  private write(values: Record<string, string>): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(values, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
      chmodSync(this.path, 0o600);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

export class KeychainSecretStore implements SecretStore {
  readonly backend = "keychain" as const;
  private readonly run: (args: string[]) => SpawnSyncReturns<string>;

  constructor(
    readonly service = "omni-mcp",
    options: SecretStoreOptions = {},
  ) {
    const platform = options.platform ?? process.platform;
    if (platform !== "darwin") {
      throw new Error("macOS Keychain backend is only available on macOS");
    }
    this.run =
      options.runSecurity ??
      ((args) =>
        spawnSync("/usr/bin/security", args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }));
  }

  list(): string[] {
    return this.readIndex();
  }

  get(name: string): string | undefined {
    assertSecretName(name);
    return this.readAccount(name);
  }

  readAccount(account: string): string | undefined {
    if (!account) throw new Error("Keychain account must not be empty");
    const result = this.run(["find-generic-password", "-s", this.service, "-a", account, "-w"]);
    if (result.status === 44 || result.status === 45) return undefined;
    this.assertSuccess(result, `read Keychain account "${account}"`);
    const value = result.stdout.replace(/\r?\n$/, "");
    return value || undefined;
  }

  set(name: string, value: string): void {
    assertSecretName(name);
    if (!value) throw new Error("Secret value must not be empty");
    const previous = this.get(name);
    const previousNames = this.readIndex();
    this.addPassword(name, value);
    try {
      const names = new Set(previousNames);
      names.add(name);
      this.writeIndex([...names].sort());
    } catch (error) {
      if (previous === undefined) this.deletePassword(name);
      else this.addPassword(name, previous);
      throw error;
    }
  }

  delete(name: string): boolean {
    assertSecretName(name);
    const previous = this.get(name);
    if (!previous) return false;
    const previousNames = this.readIndex();
    this.deletePassword(name);
    try {
      this.writeIndex(previousNames.filter((entry) => entry !== name));
    } catch (error) {
      this.addPassword(name, previous);
      throw error;
    }
    return true;
  }

  import(service: string, account: string, name: string): void {
    const result = this.run(["find-generic-password", "-s", service, "-a", account, "-w"]);
    this.assertSuccess(result, `read Keychain item ${service}/${account}`);
    this.set(name, result.stdout.replace(/\r?\n$/, ""));
  }

  private readIndex(): string[] {
    const result = this.run([
      "find-generic-password",
      "-s",
      this.service,
      "-a",
      KEYCHAIN_INDEX_ACCOUNT,
      "-w",
    ]);
    if (result.status === 44 || result.status === 45) return [];
    this.assertSuccess(result, "read Keychain secret index");
    try {
      const parsed = JSON.parse(result.stdout) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((name) => typeof name === "string")) {
        throw new Error("index is not an array of names");
      }
      return parsed.filter((name) => SECRET_NAME_PATTERN.test(name)).sort();
    } catch (error) {
      throw new Error(
        `Failed to parse omni-mcp Keychain index: ${error instanceof Error ? error.message : "invalid JSON"}`,
      );
    }
  }

  private writeIndex(names: string[]): void {
    this.addPassword(KEYCHAIN_INDEX_ACCOUNT, JSON.stringify(names));
  }

  private addPassword(account: string, value: string): void {
    const result = this.run([
      "add-generic-password",
      "-U",
      "-s",
      this.service,
      "-a",
      account,
      "-w",
      value,
    ]);
    this.assertSuccess(result, `write Keychain item "${account}"`);
  }

  private deletePassword(account: string): void {
    const result = this.run(["delete-generic-password", "-s", this.service, "-a", account]);
    this.assertSuccess(result, `delete Keychain secret "${account}"`);
  }

  private assertSuccess(result: SpawnSyncReturns<string>, action: string): void {
    if (result.error) throw new Error(`Failed to ${action}: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(`Failed to ${action}: ${result.stderr.trim() || `exit ${result.status}`}`);
    }
  }
}

export function migrateSecretStore(source: SecretStore, destination: SecretStore): number {
  const names = source.list();
  const sourceValues = new Map<string, string>();
  for (const name of names) {
    const value = source.get(name);
    if (!value) throw new Error(`Secret "${name}" disappeared during migration`);
    sourceValues.set(name, value);
  }
  const written: string[] = [];
  const previous = new Map<string, string | undefined>();
  try {
    for (const name of names) {
      const value = sourceValues.get(name)!;
      previous.set(name, destination.get(name));
      destination.set(name, value);
      if (destination.get(name) !== value) {
        throw new Error(`Secret "${name}" could not be verified in destination`);
      }
      written.push(name);
    }
  } catch (error) {
    for (const name of written) {
      const oldValue = previous.get(name);
      if (oldValue === undefined) destination.delete(name);
      else destination.set(name, oldValue);
    }
    throw error;
  }
  try {
    for (const name of names) source.delete(name);
  } catch (error) {
    for (const [name, value] of sourceValues) source.set(name, value);
    for (const name of written) {
      const oldValue = previous.get(name);
      if (oldValue === undefined) destination.delete(name);
      else destination.set(name, oldValue);
    }
    throw error;
  }
  return names.length;
}

