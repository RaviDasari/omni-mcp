import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildCommandDefs,
  parseToolArguments,
  runManagedCli,
  toKebab,
} from "../../src/cli/managed-cli.js";

describe("managed CLI schema mapping", () => {
  it("normalizes names and allocates stable collision aliases", () => {
    const commands = buildCommandDefs([
      { name: "foo_2" },
      { name: "foo bar" },
      { name: "foo_bar" },
    ]);

    expect(commands.map((command) => [command.originalName, command.cliName])).toEqual([
      ["foo bar", "foo-bar"],
      ["foo_2", "foo-2"],
      ["foo_bar", "foo-bar-2"],
    ]);
    expect(toKebab("readHTTPValue")).toBe("read-httpvalue");
  });

  it("reserves built-in flags and retains upstream property names", () => {
    const [command] = buildCommandDefs([
      {
        name: "run",
        inputSchema: {
          type: "object",
          properties: {
            stdin: { type: "string" },
            itemCount: { type: "integer" },
          },
          required: ["stdin"],
        },
      },
    ]);

    expect(command.params).toEqual([
      expect.objectContaining({ cliName: "item-count", originalName: "itemCount" }),
      expect.objectContaining({ cliName: "arg-stdin", originalName: "stdin", required: true }),
    ]);
  });

  it("coerces generated flags and merges JSON fallback arguments", () => {
    const [command] = buildCommandDefs([
      {
        name: "search",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer" },
            exact: { type: "boolean" },
            tags: { type: "array", items: { type: "string" } },
            filter: { type: "object" },
          },
          required: ["query"],
        },
      },
    ]);

    expect(parseToolArguments(command, [
      "--args-json", '{"query":"base","extra":true}',
      "--query", "override",
      "--limit", "5",
      "--exact",
      "--tags", "one,two",
      "--tags", '["three"]',
      "--filter", '{"state":"open"}',
    ])).toEqual({
      query: "override",
      extra: true,
      limit: 5,
      exact: true,
      tags: ["one", "two", "three"],
      filter: { state: "open" },
    });
  });

  it("supports stdin and rejects missing required arguments", () => {
    const [command] = buildCommandDefs([
      {
        name: "create",
        inputSchema: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      },
    ]);

    expect(parseToolArguments(command, ["--stdin"], '{"title":"from stdin"}')).toEqual({
      title: "from stdin",
    });
    expect(() => parseToolArguments(command, [])).toThrow('Missing required option "--title"');
  });
});

describe("managed CLI execution", () => {
  let stdout = "";
  let stderr = "";

  beforeEach(() => {
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
    process.env.OMNI_MCP_CLI_USAGE_FILE = join(
      tmpdir(),
      `omni-mcp-cli-usage-${process.pid}-${Date.now()}.json`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.OMNI_MCP_CLI_USAGE_FILE;
  });

  it("emits compact JSON discovery without diagnostics on stdout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      server: "github",
      tools: [
        { name: "list_issues", description: "List issues" },
        { name: "create_issue", description: "Create an issue" },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const code = await runManagedCli([
      "github",
      "--list",
      "--search", "list",
      "--compact",
      "--json",
      "--gateway-url", "http://127.0.0.1:6317",
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(["list-issues"]);
    expect(stderr).toBe("");
  });

  it("invokes the exact upstream tool and preserves the JSON envelope", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/tools")) {
        return new Response(JSON.stringify({
          server: "github",
          tools: [{
            name: "create_issue",
            inputSchema: {
              type: "object",
              properties: { issueTitle: { type: "string" } },
              required: ["issueTitle"],
            },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      expect(JSON.parse(String(init?.body))).toEqual({
        tool: "create_issue",
        arguments: { issueTitle: "Broken" },
      });
      return new Response(JSON.stringify({
        server: "github",
        tool: "create_issue",
        durationMs: 3,
        result: {
          content: [{ type: "text", text: "created" }],
          structuredContent: { id: 42 },
          isError: false,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const code = await runManagedCli([
      "github",
      "create-issue",
      "--issue-title", "Broken",
      "--json",
      "--gateway-url", "http://127.0.0.1:6317",
    ]);

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      content: [{ type: "text", text: "created" }],
      structuredContent: { id: 42 },
      isError: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stderr).toBe("");
  });

  it("keeps MCP error envelopes on stdout and returns a failure code", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const body = String(url).endsWith("/tools")
        ? { server: "github", tools: [{ name: "fail" }] }
        : {
            server: "github",
            tool: "fail",
            durationMs: 1,
            result: { content: [{ type: "text", text: "denied" }], isError: true },
          };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    const code = await runManagedCli([
      "github", "fail", "--json", "--gateway-url", "http://127.0.0.1:6317",
    ]);
    expect(code).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ isError: true });
    expect(stderr).toBe("");
  });
});
