import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function packageVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url));

  while (true) {
    const packagePath = join(directory, "package.json");
    if (existsSync(packagePath)) {
      const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (metadata.name === "omni-mcp-manager" && typeof metadata.version === "string") {
        return metadata.version;
      }
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("Unable to resolve omni-mcp version from package.json");
    }
    directory = parent;
  }
}

export const VERSION = packageVersion();
