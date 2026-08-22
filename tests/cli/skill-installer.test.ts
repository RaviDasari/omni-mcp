import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installAgentSkill } from "../../src/cli/skill-installer.js";

const SOURCE = join(process.cwd(), "skills", "omni-mcp-cli", "SKILL.md");

describe("omni-mcp CLI skill installer", () => {
  it("installs user-wide Cursor and Claude skills by default", () => {
    const home = mkdtempSync(join(tmpdir(), "omni-mcp-skill-home-"));
    const installed = installAgentSkill({ home, sourcePath: SOURCE });

    expect(installed.map(({ target, status }) => [target, status])).toEqual([
      ["cursor", "installed"],
      ["claude", "installed"],
    ]);
    for (const result of installed) {
      expect(readFileSync(result.path, "utf8")).toContain("name: omni-mcp-cli");
    }
  });

  it("supports project-scoped single-target installs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "omni-mcp-skill-project-"));
    const [installed] = installAgentSkill({
      target: "cursor",
      scope: "project",
      cwd,
      sourcePath: SOURCE,
    });

    expect(installed.path).toBe(
      join(cwd, ".cursor", "skills", "omni-mcp-cli", "SKILL.md"),
    );
    expect(installed.status).toBe("installed");
  });

  it("does not overwrite modified skills unless forced", () => {
    const home = mkdtempSync(join(tmpdir(), "omni-mcp-skill-conflict-"));
    const [installed] = installAgentSkill({
      target: "claude",
      home,
      sourcePath: SOURCE,
    });
    writeFileSync(installed.path, "custom instructions\n");

    expect(() => installAgentSkill({
      target: "claude",
      home,
      sourcePath: SOURCE,
    })).toThrow("--force");

    const [updated] = installAgentSkill({
      target: "claude",
      home,
      sourcePath: SOURCE,
      force: true,
    });
    expect(updated.status).toBe("updated");
    expect(readFileSync(updated.path, "utf8")).toContain("name: omni-mcp-cli");
  });

  it("reports unchanged when the installed skill is current", () => {
    const home = mkdtempSync(join(tmpdir(), "omni-mcp-skill-current-"));
    installAgentSkill({ target: "cursor", home, sourcePath: SOURCE });
    const [result] = installAgentSkill({ target: "cursor", home, sourcePath: SOURCE });
    expect(result.status).toBe("unchanged");
  });
});
