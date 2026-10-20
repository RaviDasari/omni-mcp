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
import { DEFAULT_VARIABLES_PATH } from "../cli/config-path.js";
import { assertSecretName, type SecretStore } from "./secret-store.js";

export type VariableType = "secret" | "plain";

export interface VariableCatalogEntry {
  type: VariableType;
  value?: string;
}

export interface ManagedVariable {
  name: string;
  type: VariableType;
  set: boolean;
  value?: string;
}

export interface VariableStoreOptions {
  variablesFilePath?: string;
}

export class VariableStore {
  readonly variablesPath: string;

  constructor(
    readonly secretStore: SecretStore,
    options: VariableStoreOptions = {},
  ) {
    this.variablesPath = options.variablesFilePath ?? DEFAULT_VARIABLES_PATH;
  }

  list(): ManagedVariable[] {
    const catalog = this.readCatalog();
    const secretNames = new Set(this.secretStore.list());
    this.assertNoCollisions(catalog, secretNames);
    const names = new Set([...Object.keys(catalog), ...secretNames]);
    return [...names].sort().map((name) => {
      const entry = catalog[name];
      if (entry?.type === "plain") {
        return { name, type: "plain", set: true, value: entry.value };
      }
      return { name, type: "secret", set: secretNames.has(name) };
    });
  }

  get(name: string): string | undefined {
    assertSecretName(name);
    const catalog = this.readCatalog();
    const secretValue = this.secretStore.get(name);
    const entry = catalog[name];
    if (entry?.type === "plain" && secretValue !== undefined) {
      throw new Error(`Variable "${name}" exists as both plain and secret`);
    }
    return entry?.type === "plain" ? entry.value : secretValue;
  }

  getType(name: string): VariableType | undefined {
    assertSecretName(name);
    const catalog = this.readCatalog();
    const secretSet = this.secretStore.get(name) !== undefined;
    const entry = catalog[name];
    if (entry?.type === "plain" && secretSet) {
      throw new Error(`Variable "${name}" exists as both plain and secret`);
    }
    if (entry) return entry.type;
    return secretSet ? "secret" : undefined;
  }

  set(name: string, value: string, type: VariableType = "secret"): void {
    assertSecretName(name);
    assertValue(value);
    const currentType = this.getType(name);
    if (currentType && currentType !== type) {
      throw new Error(
        `Variable "${name}" is ${currentType}; convert it to ${type} before replacing its value`,
      );
    }

    const catalog = this.readCatalog();
    if (type === "plain") {
      catalog[name] = { type: "plain", value };
      this.writeCatalog(catalog);
      return;
    }

    const previous = this.secretStore.get(name);
    this.secretStore.set(name, value);
    try {
      catalog[name] = { type: "secret" };
      this.writeCatalog(catalog);
    } catch (error) {
      if (previous === undefined) this.secretStore.delete(name);
      else this.secretStore.set(name, previous);
      throw error;
    }
  }

  delete(name: string): boolean {
    assertSecretName(name);
    const catalog = this.readCatalog();
    const entry = catalog[name];
    if (entry?.type === "plain") {
      delete catalog[name];
      this.writeCatalog(catalog);
      return true;
    }

    const deleted = this.secretStore.delete(name);
    if (!deleted && !entry) return false;
    delete catalog[name];
    this.writeCatalog(catalog);
    return true;
  }

  convert(name: string, type: VariableType): void {
    assertSecretName(name);
    const currentType = this.getType(name);
    if (!currentType) throw new Error(`Variable "${name}" was not found`);
    if (currentType === type) return;

    const catalog = this.readCatalog();
    const previousCatalog = structuredClone(catalog);
    if (currentType === "secret") {
      const value = this.secretStore.get(name);
      if (!value) throw new Error(`Secret Variable "${name}" is unset`);
      catalog[name] = { type: "plain", value };
      this.writeCatalog(catalog);
      try {
        if (!this.secretStore.delete(name)) throw new Error("secret value disappeared");
      } catch (error) {
        this.writeCatalog(previousCatalog);
        throw new Error(
          `Failed to convert Variable "${name}" to plain: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
      return;
    }

    const value = catalog[name]?.value;
    if (!value) throw new Error(`Plain Variable "${name}" is unset`);
    this.secretStore.set(name, value);
    try {
      catalog[name] = { type: "secret" };
      this.writeCatalog(catalog);
    } catch (error) {
      this.secretStore.delete(name);
      this.writeCatalog(previousCatalog);
      throw error;
    }
  }

  private assertNoCollisions(
    catalog: Record<string, VariableCatalogEntry>,
    secretNames: Set<string>,
  ): void {
    for (const [name, entry] of Object.entries(catalog)) {
      if (entry.type === "plain" && secretNames.has(name)) {
        throw new Error(`Variable "${name}" exists as both plain and secret`);
      }
    }
  }

  private readCatalog(): Record<string, VariableCatalogEntry> {
    if (!existsSync(this.variablesPath)) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.variablesPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Failed to parse variables file ${this.variablesPath}: ${error instanceof Error ? error.message : "invalid JSON"}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Variables file ${this.variablesPath} must contain a JSON object`);
    }
    const result: Record<string, VariableCatalogEntry> = {};
    for (const [name, raw] of Object.entries(parsed)) {
      assertSecretName(name);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error(`Variable "${name}" in ${this.variablesPath} must be an object`);
      }
      const type = (raw as { type?: unknown }).type;
      const value = (raw as { value?: unknown }).value;
      if (type !== "secret" && type !== "plain") {
        throw new Error(`Variable "${name}" has invalid type`);
      }
      if (type === "plain") {
        if (typeof value !== "string" || value.length === 0) {
          throw new Error(`Plain Variable "${name}" must have a non-empty value`);
        }
        result[name] = { type, value };
      } else {
        if (value !== undefined) {
          throw new Error(`Secret Variable "${name}" must not store a value in variables.json`);
        }
        result[name] = { type };
      }
    }
    return result;
  }

  private writeCatalog(entries: Record<string, VariableCatalogEntry>): void {
    const dir = dirname(this.variablesPath);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const temporary = `${this.variablesPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(entries, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.variablesPath);
      chmodSync(this.variablesPath, 0o600);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}

function assertValue(value: string): void {
  if (!value) throw new Error("Variable value must not be empty");
}
