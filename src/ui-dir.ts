import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the built SPA (`index.html`). Production copies live in `dist/ui`.
 */
export function resolveUiDir(): string | undefined {
  if (process.env.OMNI_MCP_UI_DIR) {
    const envDir = process.env.OMNI_MCP_UI_DIR;
    if (existsSync(join(envDir, "index.html"))) return envDir;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "ui"),
    join(here, "../ui"),
    join(process.cwd(), "dist/ui"),
    join(process.cwd(), "web/dist"),
  ];

  return candidates.find((dir) => existsSync(join(dir, "index.html")));
}
