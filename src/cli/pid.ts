import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PID_DIR = join(homedir(), ".omni-mcp");
const PID_FILE = process.env["OMNI_MCP_PID_FILE"] ?? join(PID_DIR, "omni-mcp.pid");
const RUNTIME_FILE = process.env["OMNI_MCP_RUNTIME_FILE"] ?? join(PID_DIR, "runtime.json");

export interface RuntimeMetadata {
  pid: number;
  configPath: string;
  host: string;
  port: number;
}

export function writePidFile(pid: number = process.pid): void {
  if (!existsSync(PID_DIR)) {
    mkdirSync(PID_DIR, { recursive: true });
  }
  writeFileSync(PID_FILE, String(pid));
}

export function readPidFile(): number | null {
  try {
    const content = readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // Ignore if already removed
  }
  try {
    unlinkSync(RUNTIME_FILE);
  } catch {
    // Ignore if already removed
  }
}

export function writeRuntimeMetadata(metadata: RuntimeMetadata): void {
  mkdirSync(PID_DIR, { recursive: true });
  const temp = `${RUNTIME_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
  renameSync(temp, RUNTIME_FILE);
}

export function readRuntimeMetadata(): RuntimeMetadata | undefined {
  try {
    const value = JSON.parse(readFileSync(RUNTIME_FILE, "utf8")) as RuntimeMetadata;
    if (
      typeof value.pid === "number" &&
      typeof value.configPath === "string" &&
      typeof value.host === "string" &&
      typeof value.port === "number"
    ) return value;
  } catch {
    // Missing or malformed metadata falls back to config discovery.
  }
  return undefined;
}
