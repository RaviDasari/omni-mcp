# TOON Output

## Purpose

Tool results are frequently large JSON documents. [TOON](https://github.com/toon-format/toon)
(Token-Oriented Object Notation) encodes the same data in far fewer LLM tokens, especially for
uniform arrays of objects. omni-mcp converts JSON tool output to TOON in two places.

## Conversion rules (`src/toon.ts`)

- Only `text` content items whose text parses as a JSON **object or array** are converted.
- The converted text is used only when it is shorter than the original.
- `structuredContent` and non-text items (images, resources) are never changed, so clients can
  still validate against an `outputSchema`.
- Encoding uses the official `@toon-format/toon` package.

## CLI mode

`omni-mcp cli <server> <tool>` converts JSON text results to TOON by default.

| Flag | Output |
|------|--------|
| (default) | Text content, JSON converted to TOON |
| `--raw` | Text content exactly as returned by the upstream server |
| `--json` | Full MCP `CallToolResult` as JSON |

The CLI converts JSON text itself, so it works for every server. If the server also has TOON enabled
(see below), the gateway has already converted the text, which the CLI prints unchanged; `--raw` then
shows that gateway output.

## MCP mode

Each server has an opt-in setting (default `false`):

```json
"servers": { "jira": { "type": "stdio", "command": "...", "toon": { "enabled": true } } }
```

When enabled, `tools/call` responses to MCP clients for that server carry TOON text. This works
independently of `cli.enabled`. Changing `toon` never restarts the upstream server.

Manage it with `omni-mcp server toon-enable <name>` / `toon-disable <name>`, the TOON switch on
the Servers page, or `PUT /api/servers/:name/toon-enabled` with `{ "enabled": true }`.
The server setting applies to every surface, so they all show exactly what an MCP client receives:
`tools/call` over `/mcp`, the Playground (`/api/servers/:name/tools/call`), and the CLI endpoint
(`/api/cli/servers/:name/tools/call`).
