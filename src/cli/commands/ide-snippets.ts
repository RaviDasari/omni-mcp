interface IdeSnippetsOptions {
  token?: string;
  port?: string;
}

export async function ideSnippetsCommand(options: IdeSnippetsOptions): Promise<void> {
  const token = options.token ?? "default";
  const port = options.port ?? "6317";
  const url = `http://127.0.0.1:${port}/mcp`;

  const output = `
🌐 omni-mcp — IDE Configuration Snippets
──────────────────────────────────────────

Your gateway: ${url}

━━━ Cursor ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Add to ~/.cursor/mcp.json:

{
  "mcpServers": {
    "omni-mcp": {
      "url": "${url}",
      "headers": {
        "Authorization": "******"
      }
    }
  }
}

━━━ VS Code (GitHub Copilot) ━━━━━━━━━━━
Add to .vscode/mcp.json:

{
  "servers": {
    "omni-mcp": {
      "type": "http",
      "url": "${url}",
      "headers": {
        "Authorization": "******"
      }
    }
  }
}

━━━ Claude Desktop ━━━━━━━━━━━━━━━━━━━━━
Add to your Claude Desktop config:

{
  "mcpServers": {
    "omni-mcp": {
      "url": "${url}",
      "headers": {
        "Authorization": "******"
      }
    }
  }
}

━━━ Windsurf ━━━━━━━━━━━━━━━━━━━━━━━━━━━
Add to ~/.windsurf/mcp.json:

{
  "mcpServers": {
    "omni-mcp": {
      "url": "${url}",
      "headers": {
        "Authorization": "******"
      }
    }
  }
}

━━━ Any MCP Client (curl test) ━━━━━━━━━
curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: ******" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
`;

  process.stdout.write(output);
}
