import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { loadConfig, resolveConfig, type OmniMcpConfig } from "../config/index.js";

export function readRawConfig(configPath: string): OmniMcpConfig {
  const loaded = loadConfig(configPath);
  if (!loaded.rawConfig) {
    throw new Error(loaded.errors.map((error) => error.message).join("; ") || "Invalid config");
  }
  return loaded.rawConfig;
}

export function readJsonConfig(configPath: string): Record<string, unknown> {
  const path = resolve(configPath);
  if (!existsSync(path)) throw new Error(`Config file not found: ${path}`);
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("config root must be an object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to read config ${path}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

export function validateAndWriteConfig(
  configPath: string,
  raw: Record<string, unknown>,
): OmniMcpConfig {
  const result = resolveConfig(raw);
  if (!result.rawConfig) {
    throw new Error(
      `Validation failed: ${result.errors.map((error) => error.message).join("; ")}`,
    );
  }
  atomicWriteJson(configPath, result.rawConfig);
  return result.rawConfig;
}

export function atomicWriteJson(configPath: string, value: unknown): void {
  const path = resolve(configPath);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temp, { force: true });
  }
}
