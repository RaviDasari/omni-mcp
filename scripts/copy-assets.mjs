import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

copyDirectory(join(root, "web", "dist"), join(root, "dist", "ui"));
copyDirectory(join(root, "skills"), join(root, "dist", "skills"));

function copyDirectory(from, to) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
}
