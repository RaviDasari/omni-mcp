interface IdeSnippetsOptions {
  token?: string;
  port?: string;
}

function bearerValue(token: string): string {
  return ["Bearer", token].join(" ");
}

export async function ideSnippetsCommand(options: IdeSnippetsOptions): Promise<void> {
  const token = options.token ?? "default";
  const port = options.port ?? "6317";
  const url = `http://127.0.0.1:${port}/mcp`;
  const bearer = bearerValue(token);

  const output = `
\u{1F310} omni-mcp \u2014 IDE Configuration Snippets
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Your gateway: ${url}

\u2501\u2501\u2501 Cursor \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Add to ~/.cursor/mcp.json:

{
  "mcpServers": {
    "omni-mcp": {
      "url": "${url}",
      "headers": {
        "Authorization": "${bearer}"
      }
    }
  }
}

\u2501\u2501\u2501 VS Code (GitHub Copilot) \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Add to .vscode/mcp.json:

{
  "servers": {
    "omni-mcp": {
      "type": "http",
      "url": "${url}",
      "headers": {
        "Authorization": "${bearer}"
      }
    }
  }
}

\u2501\u2501\u2501 Claude Desktop \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Add to your Claude Desktop config:

{
  "mcpServers": {
    "omni-mcp": {
      "url": "${url}",
      "headers": {
        "Authorization": "${bearer}"
      }
    }
  }
}

\u2501\u2501\u2501 Windsurf \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
Add to ~/.windsurf/mcp.json:

{
  "mcpServers": {
    "omni-mcp": {
      "url": "${url}",
      "headers": {
        "Authorization": "${bearer}"
      }
    }
  }
}

\u2501\u2501\u2501 Any MCP Client (curl test) \u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
curl -X POST ${url} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: ${bearer}" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
`;

  process.stdout.write(output);
}
