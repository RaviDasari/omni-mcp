import { buildIdeSnippets } from "../../ide/snippets.js";

interface IdeSnippetsOptions {
  token?: string;
  port?: string;
}

export async function ideSnippetsCommand(options: IdeSnippetsOptions): Promise<void> {
  const token = options.token ?? "default";
  const port = options.port ?? "6317";
  const result = buildIdeSnippets({ token, port: parseInt(port, 10) });

  const lines = [
    "",
    "omni-mcp — IDE Configuration Snippets",
    "────────────────────────────────────────",
    "",
    `Your gateway: ${result.url}`,
    "",
  ];

  for (const snippet of result.snippets) {
    lines.push(`━━━ ${snippet.title} ━━━`);
    lines.push(`Add to ${snippet.pathHint}:`);
    lines.push("");
    lines.push(snippet.json);
    lines.push("");
  }

  lines.push("━━━ Any MCP Client (curl test) ━━━");
  lines.push(result.curl);
  lines.push("");

  process.stdout.write(lines.join("\n"));
}