import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";

// Test the CLI add/remove commands by directly invoking them
import { addCommand } from "../../src/cli/commands/add.js";
import { removeCommand } from "../../src/cli/commands/remove.js";

const TEST_DIR = "/tmp/omni-mcp-cli-test";
const CONFIG_PATH = join(TEST_DIR, "omni-mcp.config.json");

describe("CLI Commands", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({
        port: 6317,
        servers: {
          filesystem: {
            type: "stdio",
            command: "echo",
            args: ["hello"],
          },
          memory: {
            type: "stdio",
            command: "echo",
            args: ["memory"],
          },
        },
        profiles: {
          default: { allow: ["*"] },
          safe: { allow: ["filesystem", "memory"] },
        },
        tokens: {
          default: { profile: "default" },
        },
      }),
    );
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("add command", () => {
    it("adds a stdio server with --command", async () => {
      // Mock process.exit to not actually exit
      const originalExit = process.exit;
      process.exit = (() => {}) as any;

      await addCommand("github", {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        profile: ["default"],
        config: CONFIG_PATH,
      });

      process.exit = originalExit;

      const config = JSON.parse(
        require("node:fs").readFileSync(CONFIG_PATH, "utf-8"),
      );
      expect(config.servers.github).toBeDefined();
      expect(config.servers.github.type).toBe("stdio");
      expect(config.servers.github.command).toBe("npx");
    });

    it("adds a server with --npx shorthand", async () => {
      const originalExit = process.exit;
      process.exit = (() => {}) as any;

      await addCommand("puppeteer", {
        type: "stdio",
        npx: "@modelcontextprotocol/server-puppeteer",
        profile: ["safe"],
        config: CONFIG_PATH,
      });

      process.exit = originalExit;

      const config = JSON.parse(
        require("node:fs").readFileSync(CONFIG_PATH, "utf-8"),
      );
      expect(config.servers.puppeteer).toBeDefined();
      expect(config.servers.puppeteer.command).toBe("npx");
      expect(config.servers.puppeteer.args).toContain("-y");
      expect(config.servers.puppeteer.args).toContain("@modelcontextprotocol/server-puppeteer");
      expect(config.profiles.safe.allow).toContain("puppeteer");
    });

    it("adds an http server", async () => {
      const originalExit = process.exit;
      process.exit = (() => {}) as any;

      await addCommand("prod-api", {
        type: "http",
        url: "https://api.example.com/mcp",
        profile: ["default"],
        config: CONFIG_PATH,
      });

      process.exit = originalExit;

      const config = JSON.parse(
        require("node:fs").readFileSync(CONFIG_PATH, "utf-8"),
      );
      expect(config.servers["prod-api"]).toBeDefined();
      expect(config.servers["prod-api"].type).toBe("http");
      expect(config.servers["prod-api"].url).toBe("https://api.example.com/mcp");
    });
  });

  describe("remove command", () => {
    it("removes a server and cleans up profiles", async () => {
      const originalExit = process.exit;
      process.exit = (() => {}) as any;

      await removeCommand("filesystem", { config: CONFIG_PATH, yes: true });

      process.exit = originalExit;

      const config = JSON.parse(
        require("node:fs").readFileSync(CONFIG_PATH, "utf-8"),
      );
      expect(config.servers.filesystem).toBeUndefined();
      expect(config.profiles.safe.allow).not.toContain("filesystem");
    });
  });
});
