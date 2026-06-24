import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const PID_DIR = join(homedir(), ".omni-mcp");
const PID_FILE = process.env["OMNI_MCP_PID_FILE"] ?? join(PID_DIR, "omni-mcp.pid");

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
}
