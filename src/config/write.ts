import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type { OmniMcpConfig } from "./schema.js";

export function writeConfig(configPath: string, config: OmniMcpConfig): void {
  const resolvedPath = resolve(configPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
