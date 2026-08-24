import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import packageJson from "../../package.json";
import { VERSION } from "../../src/version.js";

const root = join(tmpdir(), `omni-mcp-runtime-${process.pid}`);
const configPath = join(root, "custom.json");
const pidPath = join(root, "omni-mcp.pid");
const runtimePath = join(root, "runtime.json");

function config() {
  return {
    port: 8129,
    servers: { alpha: { type: "stdio", command: "alpha" } },
    profiles: { default: { allow: ["*"] } },
    tokens: { default: { profile: "default" } },
  };
}

describe("CLI runtime parity", () => {
  let stdout = "";
  let stderr = "";
  const oldPidFile = process.env.OMNI_MCP_PID_FILE;
  const oldRuntimeFile = process.env.OMNI_MCP_RUNTIME_FILE;

  beforeEach(async () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(config())}\n`);
    process.env.OMNI_MCP_PID_FILE = pidPath;
    process.env.OMNI_MCP_RUNTIME_FILE = runtimePath;
    stdout = "";
    stderr = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr += String(chunk);
      return true;
    });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
    if (oldPidFile === undefined) delete process.env.OMNI_MCP_PID_FILE;
    else process.env.OMNI_MCP_PID_FILE = oldPidFile;
    if (oldRuntimeFile === undefined) delete process.env.OMNI_MCP_RUNTIME_FILE;
    else process.env.OMNI_MCP_RUNTIME_FILE = oldRuntimeFile;
  });

  it("matches lifecycle metadata without probing an unhealthy HTTP endpoint", async () => {
    const { writeRuntimeMetadata } = await import("../../src/cli/pid.js");
    writeRuntimeMetadata({ pid: 4242, configPath, host: "127.0.0.1", port: 8129 });
    const fetchMock = vi.fn(async () => {
      throw new Error("endpoint is unhealthy");
    });
    vi.stubGlobal("fetch", fetchMock);

    const { assertRunningConfig } = await import("../../src/cli/lifecycle.js");
    await expect(assertRunningConfig(configPath, 4242)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(assertRunningConfig(join(root, "other.json"), 4242)).rejects.toThrow(
      `Running instance uses ${resolve(configPath)}`,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reloads a matching gateway without a pidfile", async () => {
    const { writeRuntimeMetadata } = await import("../../src/cli/pid.js");
    writeRuntimeMetadata({ pid: 4242, configPath, host: "127.0.0.1", port: 8129 });
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/health")) {
        return Response.json({
          status: "ok", version: VERSION, uptime: 2, host: "127.0.0.1", port: 8129,
          configPath, defaultProfile: "default", servers: {},
        });
      }
      expect(url).toBe("http://127.0.0.1:8129/api/reload");
      expect(init?.method).toBe("POST");
      return Response.json({ reloaded: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { reloadCommand } = await import("../../src/cli/commands/reload.js");
    await reloadCommand({ config: configPath });
    expect(stdout).toBe("[omni-mcp] Reload complete.\n");
    expect(stderr).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports custom runtime port, gateway version, and clean JSON status", async () => {
    const { writePidFile, writeRuntimeMetadata } = await import("../../src/cli/pid.js");
    writePidFile(process.pid);
    writeRuntimeMetadata({ pid: process.pid, configPath, host: "127.0.0.1", port: 8129 });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/health")) {
        return Response.json({
          status: "ok",
          version: "9.8.7",
          uptime: 65,
          host: "127.0.0.1",
          port: 8129,
          configPath,
          defaultProfile: "default",
          servers: {
            alpha: {
              enabled: true, cliEnabled: false, status: "connected",
              transport: "stdio", restarts: 0,
            },
          },
        });
      }
      if (url.endsWith("/api/config")) return Response.json({ config: config() });
      if (url.endsWith("/api/servers/alpha/tools")) return Response.json({ tools: [{ name: "ping" }] });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { statusCommand } = await import("../../src/cli/commands/status.js");
    await statusCommand({ config: configPath, json: true });
    const payload = JSON.parse(stdout);
    expect(payload).toMatchObject({
      version: "9.8.7",
      pid: process.pid,
      address: "http://127.0.0.1:8129",
      configPath: resolve(configPath),
    });
    expect(payload.servers.alpha.toolCount).toBe(1);
    expect(stdout.endsWith("\n")).toBe(true);
    expect(stdout.trim().split("\n")).toHaveLength(1);
    expect(stderr).toBe("");
  });

  it("resolves the CLI/runtime version from package metadata", () => {
    expect(VERSION).toBe(packageJson.version);
  });
});
