import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillTarget = "cursor" | "claude" | "all";
export type SkillScope = "user" | "project";

export interface InstallSkillOptions {
  target?: SkillTarget;
  scope?: SkillScope;
  force?: boolean;
  json?: boolean;
  cwd?: string;
  home?: string;
  sourcePath?: string;
}

export interface InstalledSkill {
  target: Exclude<SkillTarget, "all">;
  path: string;
  status: "installed" | "updated" | "unchanged";
}

const SKILL_NAME = "omni-mcp-cli";

export function installAgentSkill(options: InstallSkillOptions = {}): InstalledSkill[] {
  const target = options.target ?? "all";
  const scope = options.scope ?? "user";
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const sourcePath = options.sourcePath ?? resolveBundledSkillPath();
  const content = readFileSync(sourcePath, "utf8");
  const destinations = skillDestinations(target, scope, cwd, home);

  const conflicts = destinations.filter(({ path }) => {
    if (!existsSync(path)) return false;
    return readFileSync(path, "utf8") !== content;
  });
  if (conflicts.length > 0 && !options.force) {
    throw new Error(
      `Skill already exists with different content: ${conflicts.map(({ path }) => path).join(", ")}. ` +
      "Re-run with --force to replace it.",
    );
  }

  return destinations.map(({ target: destinationTarget, path }) => {
    const existed = existsSync(path);
    const unchanged = existed && readFileSync(path, "utf8") === content;
    if (!unchanged) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, { encoding: "utf8", mode: 0o644 });
    }
    return {
      target: destinationTarget,
      path,
      status: unchanged ? "unchanged" : existed ? "updated" : "installed",
    };
  });
}

export async function runInstallSkill(argv: string[]): Promise<number> {
  try {
    const options = parseInstallSkillArgs(argv);
    if (options.help) {
      printInstallSkillHelp();
      return 0;
    }
    const installed = installAgentSkill(options);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ skills: installed })}\n`);
    } else {
      for (const skill of installed) {
        process.stdout.write(`${skill.status}: ${skill.target} → ${skill.path}\n`);
      }
      process.stdout.write(
        "Cursor and Claude will discover the skill in new agent sessions.\n",
      );
    }
    return 0;
  } catch (error) {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : "Unknown error"}\n`);
    return 1;
  }
}

interface ParsedInstallSkillOptions extends InstallSkillOptions {
  help: boolean;
}

function parseInstallSkillArgs(argv: string[]): ParsedInstallSkillOptions {
  const options: ParsedInstallSkillOptions = { help: false };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    const [name, inlineValue] = token.split(/=(.*)/s, 2);
    const takeValue = (): string => {
      const value = inlineValue ?? argv[++index];
      if (!value) throw new Error(`${name} requires a value`);
      return value;
    };
    if (name === "--target") {
      const value = takeValue();
      if (!["cursor", "claude", "all"].includes(value)) {
        throw new Error("--target must be cursor, claude, or all");
      }
      options.target = value as SkillTarget;
    } else if (name === "--scope") {
      const value = takeValue();
      if (!["user", "project"].includes(value)) {
        throw new Error("--scope must be user or project");
      }
      options.scope = value as SkillScope;
    } else if (name === "--force") {
      options.force = true;
    } else if (name === "--json") {
      options.json = true;
    } else if (name === "--help" || name === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option "${token}"`);
    }
  }
  return options;
}

function skillDestinations(
  target: SkillTarget,
  scope: SkillScope,
  cwd: string,
  home: string,
): Array<{ target: "cursor" | "claude"; path: string }> {
  const targets: Array<"cursor" | "claude"> =
    target === "all" ? ["cursor", "claude"] : [target];
  return targets.map((name) => ({
    target: name,
    path: scope === "user"
      ? join(home, `.${name}`, "skills", SKILL_NAME, "SKILL.md")
      : join(cwd, `.${name}`, "skills", SKILL_NAME, "SKILL.md"),
  }));
}

function resolveBundledSkillPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "skills", SKILL_NAME, "SKILL.md"),
    join(moduleDir, "..", "skills", SKILL_NAME, "SKILL.md"),
    join(process.cwd(), "skills", SKILL_NAME, "SKILL.md"),
  ];
  const match = candidates.find(existsSync);
  if (!match) {
    throw new Error(
      `Bundled ${SKILL_NAME} skill was not found. Reinstall omni-mcp-manager or run from its project directory.`,
    );
  }
  return match;
}

function printInstallSkillHelp(): void {
  process.stdout.write(
    "Usage: omni-mcp cli install-skill [options]\n\n" +
    "Install the omni-mcp CLI skill for AI coding agents.\n\n" +
    "Options:\n" +
    "  --target <target>  cursor, claude, or all (default: all)\n" +
    "  --scope <scope>    user or project (default: user)\n" +
    "  --force            Replace a modified existing skill\n" +
    "  --json             Emit machine-readable installation results\n" +
    "  --help             Show this help\n",
  );
}
