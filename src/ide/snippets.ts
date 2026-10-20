export interface IdeSnippet {
  id: string;
  title: string;
  pathHint: string;
  altPaths?: string[];
  json: string;
}

export interface IdeSnippetsResult {
  url: string;
  token: string;
  snippets: IdeSnippet[];
  curl: string;
}

function bearerValue(token: string): string {
  return ["Bearer", token].join(" ");
}

export function buildIdeSnippets(options: {
  token?: string;
  port?: number;
  host?: string;
}): IdeSnippetsResult {
  const token = options.token ?? "default";
  const port = options.port ?? 6317;
  const host = options.host && options.host !== "0.0.0.0" ? options.host : "127.0.0.1";
  const url = `http://${host}:${port}/mcp`;
  const bearer = bearerValue(token);

  const cursor = {
    mcpServers: {
      "omni-mcp": {
        url,
        headers: { Authorization: bearer },
      },
    },
  };

  const vscode = {
    servers: {
      "omni-mcp": {
        type: "http",
        url,
        headers: { Authorization: bearer },
      },
    },
  };

  // Claude Desktop only launches stdio commands from its config file, so the
  // HTTP gateway is reached through the mcp-remote bridge.
  const claudeDesktop = {
    mcpServers: {
      "omni-mcp": {
        command: "npx",
        args: ["-y", "mcp-remote", url, "--header", `Authorization: ${bearer}`],
      },
    },
  };

  return {
    url,
    token,
    snippets: [
      {
        id: "cursor",
        title: "Cursor",
        pathHint: "~/.cursor/mcp.json",
        json: JSON.stringify(cursor, null, 2),
      },
      {
        id: "vscode",
        title: "VS Code (GitHub Copilot)",
        pathHint: ".vscode/mcp.json",
        json: JSON.stringify(vscode, null, 2),
      },
      {
        id: "claude-code",
        title: "Claude Code",
        pathHint: "~/.claude.json",
        json: JSON.stringify(cursor, null, 2),
      },
      {
        id: "claude-desktop",
        title: "Claude Desktop",
        pathHint: "~/Library/Application Support/Claude/claude_desktop_config.json",
        altPaths: [
          "%APPDATA%\\Claude\\claude_desktop_config.json (Windows)",
          "~/.config/Claude/claude_desktop_config.json (Linux)",
        ],
        json: JSON.stringify(claudeDesktop, null, 2),
      },
      {
        id: "windsurf",
        title: "Windsurf",
        pathHint: "~/.codeium/windsurf/mcp_config.json",
        json: JSON.stringify(cursor, null, 2),
      },
    ],
    curl: `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: ${bearer}" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  };
}
