import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";

const root = join(tmpdir(), `omni-mcp-import-secrets-${process.pid}`);

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("node:os");
  rmSync(root, { recursive: true, force: true });
});

describe("init import parity", () => {
  it("keeps deterministic names for cross-IDE conflicts and writes normal defaults", async () => {
    const home = join(root, "home");
    const project = join(root, "project");
    const output = join(root, "generated", "config.json");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    mkdirSync(join(project, ".vscode"), { recursive: true });
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: {
        shared: { command: "cursor-shared" },
        cursorOnly: { url: "https://cursor.example/mcp" },
      },
    }));
    writeFileSync(join(project, ".vscode", "mcp.json"), JSON.stringify({
      servers: {
        shared: { command: "workspace-shared", args: ["--workspace"] },
      },
    }));
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      return { ...actual, homedir: () => home };
    });
    vi.resetModules();
    const oldCwd = process.cwd();
    process.chdir(project);
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    try {
      const { initCommand } = await import("../../src/cli/commands/init.js");
      await initCommand({ import: true, yes: true, output, template: "minimal" });
    } finally {
      process.chdir(oldCwd);
    }

    const generated = JSON.parse(readFileSync(output, "utf8"));
    expect(Object.keys(generated.servers)).toEqual(["shared", "cursorOnly", "shared-2"]);
    expect(generated.servers.shared.command).toBe("cursor-shared");
    expect(generated.servers["shared-2"].command).toBe("workspace-shared");
    expect(generated.profiles).toEqual({ default: { allow: ["*"] } });
    expect(generated.tokens).toEqual({ default: { profile: "default" } });
    expect(stdout).toContain("Imported: 3 server(s) from Cursor, VS Code workspace");
  });
});

describe("secrets offline parity", () => {
  it("prints reload notices offline and never emits inline secret values in JSON", async () => {
    const home = join(root, "home");
    const configPath = join(root, "config.json");
    mkdirSync(root, { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      port: 6550,
      servers: {
        alpha: {
          type: "stdio",
          command: "alpha",
          env: { API_TOKEN: "super-secret-value", REFERENCED: "$ALREADY_SAFE" },
        },
      },
      profiles: { default: { allow: ["*"] } },
      tokens: { default: { profile: "default" } },
      secretStore: { backend: "file", keychainService: "omni-mcp" },
    }));
    vi.doMock("node:os", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:os")>();
      return { ...actual, homedir: () => home };
    });
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    let stdout = "";
    let stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    const { registerSecretsCommand } = await import("../../src/cli/commands/secrets.js");

    const preview = new Command().name("omni-mcp").exitOverride();
    registerSecretsCommand(preview);
    await preview.parseAsync([
      "node", "omni-mcp", "secrets", "migrate", "--inline", "--json", "--config", configPath,
    ]);
    const payload = JSON.parse(stdout);
    expect(payload.candidates).toEqual([
      expect.objectContaining({ name: "API_TOKEN", path: "servers.alpha.env.API_TOKEN" }),
    ]);
    expect(stdout).not.toContain("super-secret-value");
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(stderr).toBe("");

    stdout = "";
    const sync = new Command().name("omni-mcp").exitOverride();
    registerSecretsCommand(sync);
    await sync.parseAsync(["node", "omni-mcp", "secrets", "sync", "--config", configPath]);
    expect(stdout).toContain("Validated 0 secret(s)");
    expect(stdout).toContain("offline");
    expect(stdout).toContain("omni-mcp reload --config");
    expect(stdout).not.toContain("super-secret-value");
    expect(stderr).toBe("");
  });
});
