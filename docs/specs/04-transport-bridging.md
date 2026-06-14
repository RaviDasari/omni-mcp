# omni-mcp — Transport Bridging Spec

## Overview

omni-mcp bridges two types of upstream MCP server transports to the unified HTTP gateway:

| Transport | Config `type` | Description |
|-----------|--------------|-------------|
| **stdio** | `"stdio"` | Local process launched by omni-mcp; communication via stdin/stdout |
| **HTTP** | `"http"` | Remote or local MCP server accessed over HTTP with optional JWT auth |

The gateway client sees only the single HTTP endpoint — transport details are hidden inside the bridge layer.

---

## stdio Bridge

### How It Works

1. omni-mcp spawns the configured command as a child process.
2. The bridge writes JSON-RPC requests to the child's `stdin` and reads JSON-RPC responses from `stdout`.
3. `stderr` output from the child process is captured and logged as `[server-name][stderr]` at `debug` level.
4. The spawned process is kept alive for the lifetime of the omni-mcp daemon; it is not spawned per-request.

### Process Lifecycle

```text
omni-mcp start
  │
  ├─ spawn "npx -y @modelcontextprotocol/server-filesystem /docs"
  │       └─ stdio tunnel established
  │
  ├─ send MCP initialize → receive capabilities
  │
  └─ ready to accept tool calls
```

### Configuration

```jsonc
{
  "servers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"],

      // Optional. Restart policy (see spec 05-resilience.md).
      "maxRestarts": 3,

      // Optional. Restart backoff base in ms. Default: 1000. Doubles each retry.
      "restartBackoffMs": 1000,

      // Optional. Working directory for the child process.
      "cwd": "/home/user",

      // Optional. Extra environment variables passed to the child process.
      // Supports $VAR_NAME interpolation.
      "env": {
        "GITHUB_TOKEN": "$GITHUB_TOKEN"
      }
    }
  }
}
```

### Process Environment

The child process inherits the full environment of the omni-mcp process, plus any additional `env` entries defined in config. `env` entries override inherited values when there is a conflict.

### Shutdown

On `omni-mcp stop` or SIGTERM:
1. Send SIGTERM to the child process.
2. Wait up to 5 seconds for graceful exit.
3. If still running, send SIGKILL.

---

## HTTP Bridge

### How It Works

1. omni-mcp connects to the configured remote URL.
2. For each tool call, it performs a POST to `<url>/mcp` (MCP Streamable HTTP transport).
3. If `auth.type` is `"jwt"`, the resolved token value is injected as `Authorization: ****** on every request.
4. The bridge handles SSE streaming for long-running tool responses.

### Configuration

```jsonc
{
  "servers": {
    "production-db": {
      "type": "http",
      "url": "https://internal.tools/mcp",

      // Optional. Authentication injected at the proxy layer.
      "auth": {
        "type": "jwt",
        "token": "$PROD_DB_JWT"   // Must be an env var reference
      },

      // Optional. Per-request timeout in milliseconds. Default: 30000.
      "timeoutMs": 30000,

      // Optional. Number of retry attempts on transient errors (5xx, network). Default: 2.
      "retries": 2,

      // Optional. Retry backoff base in ms. Default: 500. Doubles each retry.
      "retryBackoffMs": 500
    }
  }
}
```

### Authentication Injection

JWT tokens are **never** visible to the client. They are injected at the bridge layer after the gateway has authenticated the client with its own token:

```
Client → Gateway (client token)
Gateway → Upstream (upstream JWT, injected from env)
```

The client token and the upstream JWT are entirely separate credentials.

### HTTP Connection Behavior

- The bridge maintains a persistent HTTP connection (keep-alive) to each `http` server.
- On connection failure, the bridge retries with exponential backoff up to `retries` attempts.
- After all retries are exhausted, the server status is set to `"error"` and the gateway returns an MCP error for any tool calls targeting that server.
- The bridge attempts reconnection at a configurable interval (`reconnectIntervalMs`, default: `30000`).

### TLS/HTTPS

- The bridge uses Node.js built-in HTTPS support (system CA bundle).
- Custom CA certificates can be provided via the standard `NODE_EXTRA_CA_CERTS` environment variable.
- Self-signed certificates require either `NODE_TLS_REJECT_UNAUTHORIZED=0` (not recommended) or a custom CA cert.

---

## Bridge Abstraction

Both transports implement the same internal `ServerAdapter` interface:

```typescript
interface ServerAdapter {
  connect(): Promise<void>;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  disconnect(): Promise<void>;
  readonly status: "connecting" | "connected" | "error" | "disabled";
}
```

The gateway router calls `listTools()` and `callTool()` without knowing which transport is in use.

---

## Initialization Sequence

On startup, the gateway initializes all configured (and profile-allowed) servers concurrently:

```text
For each server in config:
  1. Create adapter (StdioAdapter or HttpAdapter)
  2. adapter.connect()
     - stdio: spawn process, send MCP initialize, receive capabilities
     - http: send MCP initialize to remote URL, receive capabilities
  3. Cache tool list from adapter.listTools()
  4. Mark server status as "connected"

If any server fails to initialize:
  - Log error with server name and cause
  - Mark server status as "error"
  - Continue startup (partial availability is acceptable)
  - A server in "error" state can recover via restart/reconnect
```

---

## Tool List Caching

- Tool lists are fetched at server initialization and cached in memory.
- Tool lists are NOT re-fetched on every `tools/list` request (for performance).
- The cache is refreshed on:
  - Server restart (crash recovery)
  - Explicit `omni-mcp reload` CLI command
  - `SIGHUP` signal to the main process

---

## Error Handling Summary

| Scenario | Behavior |
|----------|----------|
| stdio process fails to start | Server marked `"error"`, startup continues |
| stdio process crashes during operation | Restart per resilience policy (see spec 05) |
| HTTP server unreachable at startup | Server marked `"error"`, startup continues |
| HTTP request timeout | MCP error returned to client; retry per `retries` setting |
| JWT token missing from env at startup | Fatal — process exits with validation error |
| HTTP 401 from upstream | MCP error `UNAUTHORIZED` returned to client; logged as warning |
| HTTP 5xx from upstream | Retry with backoff; if all retries fail, MCP error returned |
