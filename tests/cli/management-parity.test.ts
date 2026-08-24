import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Command } from "commander";
import { registerManagementCommands } from "../../src/cli/commands/management.js";
import { atomicWriteJson, validateAndWriteConfig } from "../../src/cli/config-edit.js";

const root = join(tmpdir(), `omni-mcp-management-${process.pid}`);
const configPath = join(root, "config.json");

function baseConfig() {
  return {
    port: 7412,
    servers: {
      alpha: { type: "stdio", command: "alpha", args: [] },
      beta: { type: "http", url: "https://example.com/mcp" },
    },
    profiles: {
      default: { allow: ["*"] },
      limited: { allow: ["alpha", "beta"] },
    },
    tokens: {
      default: { profile: "default" },
      limited: { profile: "limited" },
    },
  };
}

function readConfig(): any {
  return JSON.parse(readFileSync(configPath, "utf8"));
}

async function run(...args: string[]): Promise<void> {
  const program = new Command().name("omni-mcp").exitOverride();
  registerManagementCommands(program);
  await program.parseAsync(["node", "omni-mcp", ...args]);
}

describe("management CLI parity", () => {
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
    mkdirSync(root, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(baseConfig(), null, 2)}\n`);
    stdout = "";
    stderr = "";
    process.exitCode = undefined;
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it("manages servers, profiles, and tokens offline with validated documents", async () => {
    await run("server", "add", "gamma", "--definition", '{"type":"stdio","command":"gamma"}', "--config", configPath);
    await run("server", "disable", "gamma", "--config", configPath);
    await run("server", "cli-enable", "gamma", "--config", configPath);
    await run("profile", "create", "gamma-only", "--allow", "gamma", "--config", configPath);
    await run("token", "create", "robot", "--profile", "gamma-only", "--description", "automation", "--config", configPath);
    await run("token", "disable", "robot", "--config", configPath);

    const config = readConfig();
    expect(config.servers.gamma).toMatchObject({
      type: "stdio",
      command: "gamma",
      enabled: false,
      cli: { enabled: true },
    });
    expect(config.profiles["gamma-only"]).toEqual({ allow: ["gamma"] });
    expect(config.tokens.robot).toMatchObject({
      profile: "gamma-only",
      description: "automation",
      disabled: true,
    });
    expect(stdout.match(/running process was not changed/g)).toHaveLength(6);
    expect(stderr).toBe("");
  });

  it("requires --yes without a TTY and leaves destructive targets unchanged", async () => {
    await run("server", "remove", "alpha", "--config", configPath);
    expect(process.exitCode).toBe(1);
    expect(readConfig().servers.alpha).toBeDefined();
    expect(stderr).toContain("Confirmation required; rerun with --yes");

    process.exitCode = undefined;
    stderr = "";
    await run("server", "remove", "alpha", "--yes", "--config", configPath);
    const config = readConfig();
    expect(config.servers.alpha).toBeUndefined();
    expect(config.profiles.limited.allow).toEqual(["beta"]);
    expect(process.exitCode).toBeUndefined();
    expect(stderr).toBe("");
  });

  it("protects default profile and token even with confirmation", async () => {
    await run("profile", "delete", "default", "--yes", "--config", configPath);
    expect(process.exitCode).toBe(1);
    expect(readConfig().profiles.default).toBeDefined();

    process.exitCode = undefined;
    await run("token", "delete", "default", "--yes", "--config", configPath);
    expect(process.exitCode).toBe(1);
    expect(readConfig().tokens.default).toBeDefined();
  });

  it("emits clean newline-terminated JSON for offline reads and writes", async () => {
    await run("server", "list", "--json", "--config", configPath);
    const listed = JSON.parse(stdout);
    expect(listed.map((server: { name: string }) => server.name)).toEqual(["alpha", "beta"]);
    expect(stdout.endsWith("\n")).toBe(true);
    expect(stderr).toBe("");

    stdout = "";
    await run("profile", "create", "alpha-only", "--allow", "alpha", "--json", "--config", configPath);
    const result = JSON.parse(stdout);
    expect(result.mode).toBe("offline");
    expect(result.config.profiles["alpha-only"]).toEqual({ allow: ["alpha"] });
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(stderr).toBe("");
  });

  it("uses the matching gateway for config, tools, and filtered traffic logs", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/api/health")) {
        return Response.json({
          status: "ok", version: "1.2.0", uptime: 1, host: "127.0.0.1", port: 7412,
          configPath: resolve(configPath), defaultProfile: "default", servers: {},
        });
      }
      if (url.endsWith("/api/config")) return Response.json({ config: baseConfig() });
      if (url.includes("/tools/call")) {
        return Response.json({ server: "alpha", tool: "ping", result: { content: [{ type: "text", text: "pong" }] } });
      }
      if (url.endsWith("/api/servers/alpha/tools")) {
        return Response.json({ server: "alpha", tools: [{ name: "ping", inputSchema: { type: "object" } }] });
      }
      if (url.includes("/api/traffic-logs/summary")) return Response.json({ groups: [] });
      if (url.includes("/api/traffic-logs?")) return Response.json({ entries: [], total: 0 });
      throw new Error(`Unexpected request ${url}`);
    }));

    await run("config", "show", "--json", "--config", configPath, "--gateway-url", "http://127.0.0.1:7412");
    stdout = "";
    await run("tools", "list", "alpha", "--json", "--config", configPath, "--gateway-url", "http://127.0.0.1:7412");
    expect(JSON.parse(stdout).tools[0].name).toBe("ping");
    stdout = "";
    await run("tools", "call", "alpha", "ping", "--args-json", '{"value":7}', "--json", "--config", configPath, "--gateway-url", "http://127.0.0.1:7412");
    expect(JSON.parse(stdout).result.content[0].text).toBe("pong");
    stdout = "";
    await run("logs", "list", "--server", "alpha", "--source", "cli", "--offset", "2", "--limit", "5", "--json", "--config", configPath, "--gateway-url", "http://127.0.0.1:7412");
    stdout = "";
    await run("logs", "summary", "--tool", "ping", "--group-by", "server", "--json", "--config", configPath, "--gateway-url", "http://127.0.0.1:7412");

    expect(calls.some(({ url }) => url.endsWith("/api/config"))).toBe(true);
    const listUrl = new URL(calls.find(({ url }) => url.includes("/api/traffic-logs?"))!.url);
    expect(Object.fromEntries(listUrl.searchParams)).toMatchObject({
      server: "alpha", source: "cli", offset: "2", limit: "5",
    });
    const summaryUrl = new URL(calls.find(({ url }) => url.includes("/api/traffic-logs/summary?"))!.url);
    expect(Object.fromEntries(summaryUrl.searchParams)).toMatchObject({ tool: "ping", groupBy: "server" });
    const toolCall = calls.find(({ url }) => url.endsWith("/api/servers/alpha/tools/call"));
    expect(toolCall?.init?.method).toBe("POST");
    expect(JSON.parse(String(toolCall?.init?.body))).toEqual({ tool: "ping", arguments: { value: 7 } });
    expect(stderr).toBe("");
  });

  it("falls back offline and reports a live config mismatch explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      status: "ok", version: "1.2.0", uptime: 1, host: "127.0.0.1", port: 7412,
      configPath: join(root, "other.json"), defaultProfile: "default", servers: {},
    })));

    await run("server", "show", "alpha", "--json", "--config", configPath, "--gateway-url", "http://127.0.0.1:7412");
    expect(JSON.parse(stdout).name).toBe("alpha");
    expect(stderr).toContain("Running gateway uses");
    expect(stderr).toContain("using");
    expect(stderr).toContain("offline");
  });

  it("rejects invalid replacement config without changing the original file", async () => {
    const original = readFileSync(configPath, "utf8");
    await run("config", "apply", "--yes", "--definition", '{"servers":{},"profiles":{},"tokens":{}}', "--json", "--config", configPath);
    expect(process.exitCode).toBe(1);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(stdout).toBe("");
    expect(stderr).toContain("Validation failed");
  });
});

describe("validated atomic config writes", () => {
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("replaces in the same directory with private permissions and no temp files", () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(configPath, "{}\n");
    chmodSync(configPath, 0o644);
    const result = validateAndWriteConfig(configPath, baseConfig());

    expect(result.port).toBe(7412);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(configPath, "utf8").endsWith("\n")).toBe(true);
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("cleans temporary files when atomic replacement fails", () => {
    mkdirSync(root, { recursive: true });
    const directoryTarget = join(root, "directory-target");
    mkdirSync(directoryTarget);
    expect(() => atomicWriteJson(directoryTarget, { value: true })).toThrow();
    expect(readdirSync(root).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
