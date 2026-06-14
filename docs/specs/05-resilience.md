# omni-mcp — Resilience Spec

## Overview

omni-mcp is designed to protect the developer's workspace from the cascading effects of individual MCP server failures. Each upstream server runs in isolation. A crash, hang, or misconfiguration in one server must not affect other servers or the gateway process itself.

---

## Isolation Model

Each upstream server adapter runs as an isolated unit:

```text
omni-mcp (main process)
  ├─ StdioAdapter: "filesystem"   ← separate child process
  ├─ StdioAdapter: "github"       ← separate child process
  └─ HttpAdapter:  "production-db" ← isolated async client
```

- `stdio` servers are separate OS processes. A crash in one child process does not affect any other.
- `http` servers use isolated async HTTP clients. A timeout or error in one client does not block others.
- The main gateway process never crashes due to upstream failures; it always remains available to serve clients.

---

## Crash Detection

### stdio Servers

The gateway detects a crashed stdio server when:
- The child process exits unexpectedly (non-zero or zero exit code not triggered by shutdown).
- The child process does not respond to a health probe within `healthCheckTimeoutMs` (default: `5000` ms).

### HTTP Servers

The gateway detects an unavailable HTTP server when:
- A request times out after `timeoutMs` (default: `30000` ms) and all retries are exhausted.
- The HTTP server returns 5xx consistently across all retries.
- A TCP connection to the URL cannot be established.

---

## Restart Policy (stdio only)

When a stdio server crashes, the gateway applies the following restart policy:

### Restart Algorithm

```
attempt = 0
maxRestarts = server.maxRestarts (default: 3, 0 = disabled)

on crash:
  if attempt >= maxRestarts:
    mark server as "error" (permanently down until manual reload)
    log: "[server-name] Max restarts reached. Server is down."
    return

  backoff = restartBackoffMs * 2^attempt  (default: 1s, 2s, 4s)
  log: "[server-name] Crashed. Restarting in {backoff}ms (attempt {attempt+1}/{maxRestarts})..."

  wait backoff ms
  spawn process again
  attempt++
  reset attempt counter to 0 after successful operation for 60s
```

### Restart Configuration

```jsonc
{
  "servers": {
    "filesystem": {
      "type": "stdio",
      "maxRestarts": 3,         // Max automatic restarts. 0 = never restart. Default: 3.
      "restartBackoffMs": 1000  // Initial backoff in ms. Doubles each attempt. Default: 1000.
    }
  }
}
```

### Restart Reset

The restart counter resets to `0` after the server has been continuously running without error for `60` seconds. This prevents a server that crashes every 2 minutes from being permanently disabled after a brief bad period.

---

## Gateway Behavior When a Server is Down

When a client calls a tool on a server that is in `"error"` state:

```json
{
  "jsonrpc": "2.0",
  "id": "...",
  "error": {
    "code": -32603,
    "message": "Upstream server 'filesystem' is currently unavailable. It will be retried automatically.",
    "data": {
      "server": "filesystem",
      "status": "error",
      "restarts": 3
    }
  }
}
```

The error is surfaced clearly to the AI client (and therefor visible to the user/agent) without crashing or hanging the gateway.

---

## Hang Detection

A server that is running but not responding to requests is treated as a hang.

### Detection

- Each tool call to a stdio server has an internal timeout: `callTimeoutMs` (default: `60000` ms).
- If a response is not received within this timeout, the call is aborted with a timeout error.
- After `hangThreshold` consecutive hangs (default: `3`), the server is killed (SIGKILL) and the restart policy is applied.

### Configuration

```jsonc
{
  "servers": {
    "filesystem": {
      "callTimeoutMs": 60000,
      "hangThreshold": 3
    }
  }
}
```

---

## Partial Startup

If some servers fail to initialize at startup:

- The gateway starts successfully as long as at least one server initializes.
- Failed servers are marked `"error"` and listed in the startup summary.
- If **all** servers fail to initialize, the gateway exits with code `1`.

Startup summary example:

```
[omni-mcp] Started on http://127.0.0.1:6317
[omni-mcp] Active profile: safe-coding
[omni-mcp] Servers:
  ✓  filesystem     (stdio)  — connected
  ✓  github         (stdio)  — connected
  ✗  production-db  (http)   — error: connection refused (will retry)
[omni-mcp] Warning: 1 server failed to initialize. Partial functionality available.
```

---

## Graceful Shutdown

On `SIGTERM`, `SIGINT`, or `omni-mcp stop`:

1. Stop accepting new client connections.
2. Allow in-flight requests to complete (up to `shutdownGracePeriodMs`, default: `10000` ms).
3. Send SIGTERM to all stdio child processes.
4. Wait up to 5 seconds for each child to exit cleanly.
5. SIGKILL any remaining children.
6. Exit with code `0`.

---

## Logging

All resilience events are logged to stdout with ISO 8601 timestamps:

| Event | Level | Example |
|-------|-------|---------|
| Server crash detected | `WARN` | `[filesystem] Process exited with code 1. Restarting in 1000ms (1/3)` |
| Server restart success | `INFO` | `[filesystem] Restarted successfully` |
| Max restarts reached | `ERROR` | `[filesystem] Max restarts (3) reached. Server is down.` |
| Tool call timeout | `WARN` | `[filesystem] Tool call 'read_file' timed out after 60000ms` |
| Hang detected, killing | `ERROR` | `[filesystem] Hang threshold reached (3). Killing and restarting.` |
| Server reconnected (http) | `INFO` | `[production-db] Reconnected successfully` |

---

## Summary of Resilience Defaults

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxRestarts` | `3` | Max automatic stdio restart attempts |
| `restartBackoffMs` | `1000` | Initial restart backoff (doubles each attempt) |
| `callTimeoutMs` | `60000` | Per-tool-call timeout (ms) |
| `hangThreshold` | `3` | Consecutive timeouts before kill+restart |
| `reconnectIntervalMs` | `30000` | HTTP server reconnect retry interval |
| `shutdownGracePeriodMs` | `10000` | Max time to wait for in-flight requests on shutdown |
