# omni-mcp — CLI Spec

## Overview

omni-mcp provides a command-line interface (CLI) as the primary user-facing interface for Phase 1. All management operations — starting, stopping, reloading, and inspecting the proxy — are performed via the `omni-mcp` command.

---

## Installation & Entry Point

The CLI is installed as a global npm binary:

```bash
npm install -g omni-mcp
omni-mcp --version
```

Or run without installing:

```bash
npx omni-mcp start
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
  2. servers.my-api.auth.token: "$MY_JWT" is not set in environment
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
- JWT tokens or other secret values MUST NOT appear in any log output.

---

## PID File

`omni-mcp start` writes a PID file at startup to enable `stop`, `status`, and `reload` commands to locate the running process.

| Property | Value |
|----------|-------|
| Default path | `~/.omni-mcp/omni-mcp.pid` |
| Override | `OMNI_MCP_PID_FILE` environment variable |
| Contents | Process ID as a plain integer |
| Cleanup | Removed on clean shutdown; stale files are detected and warned about |
