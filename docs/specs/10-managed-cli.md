# Managed MCP CLI

## Overview

omni-mcp can expose selected managed MCP servers as runtime-generated CLI commands. The feature
reuses the running gateway's upstream connections; it does not spawn a second MCP process.

CLI access is an explicit, local capability:

```jsonc
{
  "servers": {
    "github": {
      "type": "stdio",
      "enabled": true,
      "cli": { "enabled": true },
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
}
```

`cli.enabled` defaults to `false`. It is independent of token profiles, but the server must also be
globally enabled and connected. CLI discovery and calls use loopback-only management endpoints.

## Commands

```text
omni-mcp cli --list
omni-mcp cli <server> --list [--search <text>] [--compact] [--top <n>]
omni-mcp cli <server> <tool> --help
omni-mcp cli <server> <tool> [schema-derived flags]
```

Tool and property names are converted to stable kebab-case CLI names while their exact upstream
names are retained on the wire. Normalization collisions receive deterministic numeric suffixes.
Built-in option names receive an `arg-` prefix.

Scalar schema properties become typed flags. Arrays accept repeated, comma-separated, or JSON
values; objects accept JSON. `--args-json` and `--stdin` accept a complete JSON object and provide a
lossless fallback for complex schemas.

## Discovery and output

- `--search` matches tool names and descriptions case-insensitively.
- `--sort usage|recent|alpha|default`, `--top`, and `--compact` reduce discovery output.
- Usage tracking stores only server/tool counts and last-used timestamps in
  `~/.omni-mcp/cli-usage.json`.
- Human output prints MCP text content, then structured content as a fallback.
- `--json` writes the full MCP `CallToolResult` as valid JSON to stdout.
- `--head <n>` truncates top-level array results.
- Invalid arguments, gateway failures, and MCP `isError` results return a nonzero exit code.

The default gateway URL is `http://127.0.0.1:<configured-port>`. `--gateway-url` overrides it.

## Agent skill

omni-mcp ships an `omni-mcp-cli` Agent Skill that teaches Cursor and Claude to use compact
discovery, runtime help, JSON output, and safe invocation patterns:

```bash
# User-wide installation for both agents
omni-mcp cli install-skill

# Optional targeting and project-local installation
omni-mcp cli install-skill --target cursor --scope project
```

User-wide installs write to `~/.cursor/skills/omni-mcp-cli/SKILL.md` and
`~/.claude/skills/omni-mcp-cli/SKILL.md`. Project installs use the equivalent `.cursor/skills`
and `.claude/skills` directories under the current working directory. Existing modified skills
are preserved unless `--force` is supplied. New agent sessions discover the installed skill.

## Local API

All endpoints below are loopback-only:

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cli/servers` | List CLI-enabled servers and status |
| GET | `/api/cli/servers/:name/tools` | List the server's runtime tool definitions |
| POST | `/api/cli/servers/:name/tools/call` | Invoke a CLI-enabled server tool |
| PUT | `/api/servers/:name/cli-enabled` | Persist CLI enablement |

The dedicated API keeps CLI opt-in enforcement separate from the direct Playground API. Tool
arguments and results are not written to the usage file. Each invocation appends a metadata-only
traffic record with `source: "cli"` so it appears on `/logs` and can be filtered separately from
MCP traffic.

## Scope

The gateway already supplies persistent sessions and managed connection configuration, replacing
mcp2cli session and bake modes. OpenAPI, GraphQL, OAuth, generated wrappers, and TOON output are not
part of this capability.
