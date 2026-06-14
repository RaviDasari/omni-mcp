# omni-mcp — IDE Integration Spec

## Overview

For omni-mcp to go viral, the end-to-end setup — from install to a working IDE connection — must take **under 60 seconds**. This spec defines how omni-mcp integrates with popular AI clients and the developer experience for each.

---

## The 30-Second Pitch

Today, a developer managing MCP servers across multiple IDEs maintains **N config files** (one per IDE), each duplicating server definitions, credentials, and configuration. Adding or removing a server means editing every IDE config.

With omni-mcp:
- **One config file** defines all servers.
- **One URL** replaces all per-IDE server entries.
- **One command** (`npx omni-mcp start`) runs everything.

```
Before:  Cursor config ← 5 servers, VS Code config ← 5 servers, Claude ← 5 servers  (15 entries to maintain)
After:   Cursor config ← 1 entry, VS Code config ← 1 entry, Claude ← 1 entry  (3 entries, all pointing to omni-mcp)
```

---

## Supported Clients

### Cursor

Cursor supports remote MCP servers via HTTP transport.

**Configuration** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "omni-mcp": {
      "url": "http://127.0.0.1:6317/mcp",
      "headers": {
        "Authorization": "******"
      }
    }
  }
}
```

**Token**: Use the named token `cursor` to give Cursor its own profile (e.g., full admin access).

---

### VS Code (GitHub Copilot)

VS Code supports MCP via workspace or user-level settings.

**Configuration** (`.vscode/mcp.json` or `~/.vscode/mcp.json`):

```json
{
  "servers": {
    "omni-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:6317/mcp",
      "headers": {
        "Authorization": "******"
      }
    }
  }
}
```

**Token**: Use a named token `vscode` for VS Code-specific access control.

---

### Claude Desktop

Claude Desktop supports MCP servers defined in its configuration file.

**Configuration** (platform-dependent path):

```json
{
  "mcpServers": {
    "omni-mcp": {
      "url": "http://127.0.0.1:6317/mcp",
      "headers": {
        "Authorization": "******"
      }
    }
  }
}
```

**Token**: Use a named token `claude` to restrict Claude Desktop to safe-only tools.

---

### Windsurf

Windsurf supports MCP via its configuration format.

**Configuration** (`~/.windsurf/mcp.json`):

```json
{
  "mcpServers": {
    "omni-mcp": {
      "url": "http://127.0.0.1:6317/mcp",
      "headers": {
        "Authorization": "******"
      }
    }
  }
}
```

---

### Any MCP-Compatible Client

Any client that supports MCP Streamable HTTP transport can connect:

```
URL:    http://127.0.0.1:6317/mcp
Header: Authorization: ******
```

---

## Per-Client Profiles — The Killer Feature

The unique value of omni-mcp is giving each IDE/agent its own view of available tools:

```json
{
  "tokens": {
    "default": { "profile": "safe",   "description": "Unknown agents — restricted" },
    "cursor":  { "profile": "admin",  "description": "Cursor — full power user" },
    "claude":  { "profile": "safe",   "description": "Claude Desktop — read-only tools" },
    "ci-bot":  { "profile": "ci",     "description": "GitHub Actions — deploy tools only" }
  },
  "profiles": {
    "safe":  { "allow": ["filesystem", "memory"] },
    "admin": { "allow": ["*"] },
    "ci":    { "allow": ["github", "deploy"] }
  }
}
```

**Why this matters for virality:**
- Developers can give their "experimental" IDE full access while restricting a shared bot.
- Switching profiles is instant (change the token in the IDE config → restart the IDE).
- Adding a new server to all IDEs means editing **one file** instead of N files.

---

## Auto-Setup Flow

The ideal first-run experience (`npx omni-mcp init --import`):

```
1. Detects existing MCP configs in all IDEs
2. Imports all servers into omni-mcp.config.json
3. Generates per-IDE tokens with sensible defaults
4. Prints exact snippets to paste into each IDE
5. Optionally writes IDE configs automatically (--write-ide-configs)
```

### `--write-ide-configs` Flag (init)

When passed to `omni-mcp init`, the CLI will:
1. Back up existing IDE MCP configs (`.bak` suffix).
2. Replace each IDE's MCP server list with a single `omni-mcp` entry.
3. Print the changes made and backup locations.

```
$ npx omni-mcp init --import --write-ide-configs

...
📝 Updated IDE configs:
   ~/.cursor/mcp.json (backed up to ~/.cursor/mcp.json.bak)
   ~/Library/Application Support/Claude/claude_desktop_config.json (backed up)

💡 Restart your IDEs to pick up the changes.
```

---

## Connection Verification

### From omni-mcp side

`omni-mcp status` shows active client connections:

```
Active connections: 2
  cursor  (connected 5m ago)   profile: admin      last request: 2s ago
  claude  (connected 12m ago)  profile: safe       last request: 45s ago
```

### From client side

Clients can verify the connection using the standard MCP `initialize` handshake:

```bash
curl -X POST http://127.0.0.1:6317/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: ******" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

Expected response includes `serverInfo.name: "omni-mcp"` and aggregated capabilities.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| IDE shows "connection refused" | omni-mcp not running | Run `npx omni-mcp start` |
| IDE shows "unauthorized" | Token not in config | Add the token to `omni-mcp.config.json` or use `default` |
| Tools not appearing | Wrong profile for token | Check `omni-mcp status` and adjust token→profile mapping |
| Only some tools showing | Profile restricts access | Edit the profile's `allow` list or switch to `["*"]` |
| Timeout errors | Upstream server slow/crashed | Check `omni-mcp status` for server health |
