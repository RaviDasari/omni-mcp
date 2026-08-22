# omni-mcp — CLI Spec

## Overview

omni-mcp provides a command-line interface (CLI) as the primary user-facing interface for Phase 1. All management operations — starting, stopping, reloading, and inspecting the proxy — are performed via the `omni-mcp` command.

---

## Installation & Entry Point

The CLI is installed as a global npm binary:

```bash
npm install -g omni-mcp-manager
omni-mcp --version
```

Or run without installing:

```bash
npx omni-mcp-manager start
```

The entry point is the `omni-mcp` binary defined in `package.json#bin`.

---

## Global Flags

These flags are accepted by all commands:

| Flag | Description |
|------|-------------|
| `--config <path>` | Path to config file. Default: `./omni-mcp.config.json` |
| `--log-level <level>` | Log verbosity: `error`, `warn`, `info` (default), `debug` |
| `--version` | Print version and exit |
| `--help` | Print help and exit |

---

## Commands

### `omni-mcp cli`

Discovers and invokes tools from servers explicitly enabled with `servers.<name>.cli.enabled`.
The running local gateway is required, and CLI access is independent of token profiles.

```bash
omni-mcp cli --list
omni-mcp cli github --list --search issue
omni-mcp cli github create-issue --owner acme --repo app --title "Bug"
omni-mcp cli github create-issue --args-json '{"owner":"acme","repo":"app","title":"Bug"}' --json
```

Tool commands and flags are generated at runtime from MCP input schemas. See
[10-managed-cli.md](./10-managed-cli.md) for naming, argument, output, and security behavior.

#### Agent skill installation

```bash
omni-mcp cli install-skill [--target cursor|claude|all] [--scope user|project] [--force]
```

Installs the bundled `omni-mcp-cli` skill for Cursor and/or Claude. The defaults are `--target all`
and `--scope user`; modified existing skill files require `--force`.

### `omni-mcp secrets`

Manages write-only secret values used by exact `$NAME` / `${NAME}` references in config.
Values never appear in argv, `--json` output, or logs. See [11-managed-secrets.md](./11-managed-secrets.md).

```bash
omni-mcp secrets list [--json]
omni-mcp secrets status [--json]
omni-mcp secrets get-status [--json]
omni-mcp secrets set <name> [--stdin]
omni-mcp secrets delete <name>
omni-mcp secrets sync
omni-mcp secrets import-keychain [name] --service <svc> --account <acct> [--name <NAME>]
omni-mcp secrets migrate --backend file|keychain
omni-mcp secrets migrate --inline [--preview] [--apply] [--rename NAME=NEW_NAME ...] [--json]
```

| Command / flag | Effect |
|------|---------|
| `list` | Backend, Keychain support, and per-variable set/unset with config usage counts |
| `status`, `get-status` | Aliases of `list` |
| `set <name>` | Hidden TTY prompt, or stdin with `--stdin` or when stdin is not a TTY. No value flag |
| `delete <name>` | Remove if the raw config does not reference the name |
| `sync` | Validate and refresh variables from the active backend (file or Keychain) |
| `import-keychain` | Copy one external Keychain item into the active store; destination name is positional or `--name` |
| `migrate --backend` | Exclusive file ↔ Keychain migration (verify destination, then delete source) |
| `migrate --inline` | Preview by default; `--apply` moves config literals into the store and rewrites fields to `$NAME` |

All subcommands accept `--config <path>`. `--json` is metadata only. Values never appear in argv or
output. Inline collisions must be resolved with `--rename NAME=NEW_NAME` before `--apply`.

### `omni-mcp init`

Interactively scaffolds a new `omni-mcp.config.json` with zero manual JSON editing. Designed for a first-run experience that takes under 30 seconds.

```
omni-mcp init [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--import` | — | Auto-detect and import MCP servers from existing IDE configs (Cursor, VS Code, Claude Desktop) |
| `--yes` / `-y` | — | Accept all defaults non-interactively (useful for scripts / CI) |
| `--output <path>` | `./omni-mcp.config.json` | Output path for generated config |
| `--template <name>` | — | Start from a named template: `minimal`, `multi-agent`, `team` |

#### Interactive Flow

```
$ npx omni-mcp-manager init

🌐 omni-mcp — Quick Setup
─────────────────────────

? Found existing MCP configs:
    ✓ Cursor   (~/.cursor/mcp.json)         — 4 servers
    ✓ Claude   (~/.claude/claude_desktop_config.json) — 2 servers
  Import these servers? (Y/n) Y

? Importing servers...
    ✓ filesystem (stdio)   — from Cursor
    ✓ github (stdio)       — from Cursor
    ✓ puppeteer (stdio)    — from Cursor
    ✓ postgres (stdio)     — from Cursor
    ✓ web-search (stdio)   — from Claude Desktop
    ✓ memory (stdio)       — from Claude Desktop
  Imported 6 servers.

? Create profiles?
    default    — all servers (allow: ["*"])
    safe       — filesystem, memory (non-destructive tools)
  Accept these profiles? (Y/n) Y

? Token setup:
    default → safe (safe default for unknown agents)
    cursor  → default (full access for Cursor)
    claude  → safe (restricted for Claude Desktop)
  Accept? (Y/n) Y

✅ Config written to ./omni-mcp.config.json

🚀 Next steps:
   1. Start the proxy:  omni-mcp start
   2. Point your IDE to: http://127.0.0.1:6317/mcp
      (see: omni-mcp ide-snippets)
```

#### Auto-Discovery Paths

The `--import` flag (or the interactive prompt) scans these known locations:

| IDE / Client | Config Path | Platform |
|-------------|-------------|----------|
| Cursor | `~/.cursor/mcp.json` | All |
| VS Code (Copilot) | `~/.vscode/mcp.json` or workspace `.vscode/mcp.json` | All |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | macOS |
| Claude Desktop | `%APPDATA%/Claude/claude_desktop_config.json` | Windows |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` | Linux |

Discovery is best-effort — missing files are silently skipped.

#### Templates

| Template | Description |
|----------|-------------|
| `minimal` | 1 server (filesystem), 1 profile, 1 token — simplest working config |
| `multi-agent` | 3 servers, 2 profiles, per-IDE tokens — typical solo developer |
| `team` | Example with remote HTTP servers, JWT auth, multiple profiles |

---

### `omni-mcp add`

Adds a server to the config without manually editing JSON.

```
omni-mcp add <server-name> [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--type <type>` | `stdio` | Server type: `stdio` or `http` |
| `--command <cmd>` | — | Command to spawn (stdio only) |
| `--args <args...>` | — | Arguments for the command (stdio only) |
| `--url <url>` | — | Remote MCP server URL (http only) |
| `--profile <name>` | — | Add server to this profile's allow list. Can be repeated. |
| `--config <path>` | `./omni-mcp.config.json` | Config file path |

#### Examples

```bash
# Add a local stdio MCP server
omni-mcp add github --command npx --args "-y @modelcontextprotocol/server-github" --profile default

# Add from an npx package directly (shorthand)
omni-mcp add puppeteer --npx "@modelcontextprotocol/server-puppeteer" --profile default

# Add a remote HTTP server
omni-mcp add prod-api --type http --url "https://api.company.com/mcp" --profile admin

# Add to multiple profiles
omni-mcp add filesystem --npx "@modelcontextprotocol/server-filesystem /home/user" --profile safe --profile default
```

#### Shorthand: `--npx`

The `--npx` flag is a convenience shorthand that expands to `--command npx --args "-y <package> [extra-args...]"`. The first token is treated as the package name; any remaining tokens become additional arguments:

```bash
omni-mcp add github --npx "@modelcontextprotocol/server-github"
# Equivalent to:
omni-mcp add github --command npx --args "-y @modelcontextprotocol/server-github"

omni-mcp add filesystem --npx "@modelcontextprotocol/server-filesystem /home/user/docs"
# Equivalent to:
omni-mcp add filesystem --command npx --args "-y @modelcontextprotocol/server-filesystem /home/user/docs"
```

#### Output

```
[omni-mcp] Added server "github" (stdio) to omni-mcp.config.json
[omni-mcp] Added "github" to profile "default" allow list.
[omni-mcp] Tip: Run `omni-mcp reload` to pick up the change in a running instance (see reload command below).
```

---

### `omni-mcp remove`

Removes a server from the config.

```
omni-mcp remove <server-name> [--config <path>]
```

Removes the server entry and removes it from all profile allow lists. Prints what was removed.

---

### `omni-mcp ide-snippets`

Prints copy-paste configuration snippets for pointing popular AI clients at the running omni-mcp gateway.

```
omni-mcp ide-snippets [--token <name>] [--port <number>]
```

#### Output

```
🌐 omni-mcp — IDE Configuration Snippets
──────────────────────────────────────────

Your gateway: http://127.0.0.1:6317/mcp

━━━ Cursor ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Add to ~/.cursor/mcp.json:

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

━━━ VS Code (GitHub Copilot) ━━━━━━━━━━━
Add to .vscode/mcp.json:

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

━━━ Claude Desktop ━━━━━━━━━━━━━━━━━━━━━
Add to your Claude Desktop config:

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

━━━ Any MCP Client (curl test) ━━━━━━━━━
curl -X POST http://127.0.0.1:6317/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: ******" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

### `omni-mcp start`

Starts the proxy gateway daemon in the foreground.

```
omni-mcp start [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--profile <name>` | Config `defaultProfile` or `"default"` | Active profile for all connections that do not present a token |
| `--port <number>` | `6317` | Override the listen port |
| `--host <address>` | `127.0.0.1` | Override the bind address |
| `--config <path>` | `./omni-mcp.config.json` | Config file path |

#### Startup Output

```
[omni-mcp] v0.1.0 starting...
[omni-mcp] Config: /home/user/project/omni-mcp.config.json
[omni-mcp] Listening on http://127.0.0.1:6317

[omni-mcp] Active default profile: safe-coding
[omni-mcp] Tokens registered: default, cursor, claude (3 total)

[omni-mcp] Initializing servers...
  ✓  filesystem     (stdio)  — connected        [npx @modelcontextprotocol/server-filesystem]
  ✓  github         (stdio)  — connected        [npx @modelcontextprotocol/server-github]
  ✗  production-db  (http)   — error            [https://internal.tools/mcp — connection refused]

[omni-mcp] Ready. 2/3 servers connected. 1 server in error state.
[omni-mcp] Press Ctrl+C to stop.
```

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Clean shutdown |
| `1` | Fatal startup error (config validation failed, all servers failed to init, etc.) |
| `130` | Interrupted by SIGINT (Ctrl+C) |

---

### `omni-mcp stop`

Sends a graceful shutdown signal to a running omni-mcp process.

```
omni-mcp stop [--config <path>]
```

Behavior:
1. Reads the PID file written by `omni-mcp start` (default: `~/.omni-mcp/omni-mcp.pid`).
2. Sends SIGTERM to the process.
3. Waits for the process to exit (up to the configured `shutdownGracePeriodMs`).
4. Reports success or timeout.

```
[omni-mcp] Stopping process PID 12345...
[omni-mcp] Stopped.
```

---

### `omni-mcp status`

Prints the current state of a running omni-mcp instance.

```
omni-mcp status [--config <path>] [--json]
```

| Flag | Description |
|------|-------------|
| `--json` | Output machine-readable JSON instead of human-readable text |

#### Human-readable Output

```
omni-mcp  v0.1.0  PID: 12345  Uptime: 2h 14m
Listening: http://127.0.0.1:6317
Default profile: safe-coding

Tokens (3):
  default  →  safe-coding
  cursor   →  admin
  claude   →  safe-coding

Servers (3):
  NAME            TYPE   STATUS     RESTARTS  TOOLS
  filesystem      stdio  connected  0         3
  github          stdio  connected  1         5
  production-db   http   error      —         0
```

#### JSON Output (`--json`)

```json
{
  "version": "0.1.0",
  "pid": 12345,
  "uptime": 8040,
  "address": "http://127.0.0.1:6317",
  "defaultProfile": "safe-coding",
  "tokens": {
    "default": { "profile": "safe-coding" },
    "cursor":  { "profile": "admin" },
    "claude":  { "profile": "safe-coding" }
  },
  "servers": {
    "filesystem":    { "type": "stdio", "status": "connected", "restarts": 0, "toolCount": 3 },
    "github":        { "type": "stdio", "status": "connected", "restarts": 1, "toolCount": 5 },
    "production-db": { "type": "http",  "status": "error",     "lastError": "connection refused", "toolCount": 0 }
  }
}
```

If no running instance is found: exit code `1`, message `[omni-mcp] No running instance found.`

---

### `omni-mcp reload`

Hot-reloads the configuration without restarting the daemon or its upstream server processes.

```
omni-mcp reload [--config <path>]
```

What is reloaded:
- `tokens` block (add/remove/update tokens and profile bindings)
- `profiles` block (add/remove/update profile server lists)
- `defaultProfile`

What is NOT reloaded (requires full restart):
- `servers` block (adding/removing/modifying servers)
- `port` / `host`

```
[omni-mcp] Reloading configuration...
[omni-mcp] Tokens: 3 loaded (was 2 — added: "ci-bot")
[omni-mcp] Profiles: 4 loaded (unchanged)
[omni-mcp] Reload complete.
```

> **Tip**: Also triggered by `kill -HUP <pid>` on macOS/Linux.

---

### `omni-mcp validate`

Validates the config file without starting the daemon.

```
omni-mcp validate [--config <path>]
```

Useful in CI, pre-commit hooks, or when editing the config.

#### Success Output

```
[omni-mcp] Config valid: /home/user/project/omni-mcp.config.json
  Servers:  3 defined
  Profiles: 3 defined
  Tokens:   3 defined
  Warnings:
    - Server "production-db" is not included in any profile allow list.
```

#### Failure Output

```
[omni-mcp] Config invalid: /home/user/project/omni-mcp.config.json (2 error(s))
  1. profiles.safe-coding.allow: unknown server "nonexistent"
  2. servers.my-api.auth.token: neither the process environment nor the active secret store defines "MY_JWT"
```

Exit codes: `0` = valid, `1` = invalid.

---

## Log Format

All output (except `--json` commands) uses structured plain-text log lines:

```
[omni-mcp] 2025-01-15T10:30:00.000Z INFO  Ready. 3/3 servers connected.
[filesystem] 2025-01-15T10:31:05.123Z WARN  Process exited with code 1. Restarting in 1000ms (1/3).
[github]     2025-01-15T10:31:06.001Z INFO  Restarted successfully.
```

Format: `[<source>] <ISO8601_TIMESTAMP> <LEVEL>  <message>`

- `<source>`: `omni-mcp` for gateway events, or the server name for per-server events.
- Token values MUST NOT appear in any log output.
- JWT tokens, secret-store values, and resolved `$NAME` substitutions MUST NOT appear in any log output.

---

## PID File

`omni-mcp start` writes a PID file at startup to enable `stop`, `status`, and `reload` commands to locate the running process.

| Property | Value |
|----------|-------|
| Default path | `~/.omni-mcp/omni-mcp.pid` |
| Override | `OMNI_MCP_PID_FILE` environment variable |
| Contents | Process ID as a plain integer |
| Cleanup | Removed on clean shutdown; stale files are detected and warned about |
