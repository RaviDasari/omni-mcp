import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverMcpServers } from "../../src/cli/commands/init.js";
import { atomicWriteJson } from "../../src/cli/config-edit.js";
import { gatewayUrlFromConfig, matchingGateway } from "../../src/cli/http-client.js";

const root = join(tmpdir(), `omni-mcp-foundation-${process.pid}`);

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe("CLI foundation", () => {
  it("discovers and normalizes documented IDE config locations", () => {
    const home = join(root, "home");
    const cwd = join(root, "project");
    mkdirSync(join(home, ".cursor"), { recursive: true });
    mkdirSync(join(cwd, ".vscode"), { recursive: true });
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({
      mcpServers: {
        github: { command: "npx", args: ["-y", "github-mcp"], env: { TOKEN: "$TOKEN" } },
        "omni-mcp": { url: "http://127.0.0.1:6317/mcp" },
      },
    }));
    writeFileSync(join(cwd, ".vscode", "mcp.json"), JSON.stringify({
      servers: { github: { url: "https://example.com/mcp" } },
    }));

    expect(discoverMcpServers({ home, cwd, platform: "linux" })).toEqual([
      {
        name: "github",
        source: "Cursor",
        config: {
          type: "stdio",
          command: "npx",
          args: ["-y", "github-mcp"],
          env: { TOKEN: "$TOKEN" },
        },
      },
      {
        name: "github-2",
        source: "VS Code workspace",
        config: { type: "http", url: "https://example.com/mcp" },
      },
    ]);
  });

  it("uses configured ports and only accepts a matching live config", async () => {
    const configPath = join(root, "selected.json");
    atomicWriteJson(configPath, { port: 7123 });
    expect(gatewayUrlFromConfig(configPath)).toBe("http://127.0.0.1:7123");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "ok",
      version: "1.2.0",
      uptime: 1,
      host: "127.0.0.1",
      port: 7123,
      configPath,
      defaultProfile: "default",
      servers: {},
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    expect(await matchingGateway(configPath)).toBeDefined();
    expect(await matchingGateway(join(root, "other.json"), "http://127.0.0.1:7123")).toBeUndefined();
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({ port: 7123 });
  });
});
