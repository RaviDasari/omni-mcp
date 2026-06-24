import { join } from "node:path";
import { homedir } from "node:os";

export const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "omni-mcp");
export const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, "config.json");
