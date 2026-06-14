# omni-mcp — Proxy Gateway Spec

## Overview

omni-mcp exposes a single local HTTP endpoint that implements the MCP Streamable HTTP transport. All AI clients (Claude Desktop, Cursor, VS Code, custom agents) connect to this one URL. The gateway aggregates tools from all active upstream servers into a unified tool list and routes incoming tool calls to the correct upstream server transparently.

---

## Endpoint

| Property | Default | Override |
|----------|---------|----------|
| Bind address | `127.0.0.1` | `--host` flag or `host` in config |
| Port | `6317` | `--port` flag or `port` in config |
| Protocol | HTTP/1.1 | — |
| Transport | MCP Streamable HTTP | — |
| Base URL | `http://127.0.0.1:6317` | — |

### Why port 6317?

Port 6317 avoids common developer conflicts (`3000` React/Next.js, `5000` Flask, `8000`/`8080` general web servers, `4200` Angular). It is unprivileged (>1024) and not registered with IANA for any common service.

### Binding Behavior

- Default: binds to `127.0.0.1` only. The gateway is **not accessible from other machines** without explicit configuration.
- To allow remote connections: set `"host": "0.0.0.0"` in config or use `--host 0.0.0.0`. A warning is printed at startup when binding to any non-loopback address.

---

## MCP Transport

The gateway implements the [MCP Streamable HTTP transport](https://spec.modelcontextprotocol.io/specification/basic/transports/) at:

```
POST http://127.0.0.1:6317/mcp
GET  http://127.0.0.1:6317/mcp   (SSE stream for server→client messages)
```

All MCP JSON-RPC messages are exchanged over this endpoint.

---

## Tool Aggregation

### Single MCP Endpoint for All Servers

omni-mcp presents itself to the client as **one MCP server**. The client issues a single `tools/list` request and receives a unified list of all tools from all servers allowed by the active profile.

```
Client: tools/list
Gateway:
  → asks Server A for its tools  (filesystem: read_file, write_file, list_dir)
  → asks Server B for its tools  (github: create_pr, list_issues)
  → merges and returns combined list to client
```

### Tool Namespacing

To prevent tool name collisions across servers, all tool names are namespaced using the server key from config:

```
<server-name>__<tool-name>
```

Examples:
- `filesystem__read_file`
- `filesystem__write_file`
- `github__create_pr`
- `production-db__run_query`

The `__` (double underscore) separator is chosen to be readable and unlikely to appear in upstream tool names. Clients see namespaced names; the gateway strips the prefix before forwarding to the upstream server.

> **Note**: If an upstream server defines a tool that already contains `__`, the gateway emits a startup warning and preserves the name as-is (collision avoidance is best-effort for Phase 1).

---

## Request Routing

When the client calls a tool:

```
Client → tools/call { name: "filesystem__read_file", arguments: {...} }
```

The gateway:
1. Splits the tool name on the first `__` to extract `server = "filesystem"` and `tool = "read_file"`.
2. Verifies `filesystem` is in the active profile's allow list. If not → MCP error `UNAUTHORIZED`.
3. Forwards `tools/call { name: "read_file", arguments: {...} }` to the `filesystem` upstream adapter.
4. Returns the upstream response to the client.

### Routing Failures

| Condition | MCP Error Code | Message |
|-----------|---------------|---------|
| Unknown server prefix | `-32601` (MethodNotFound) | `"Unknown server: <name>"` |
| Server not in active profile | `-32603` (InternalError) | `"Server not available in active profile"` |
| Upstream server is down | `-32603` (InternalError) | `"Upstream server <name> is unavailable"` |
| Tool not found on upstream | Forwarded from upstream | — |

---

## Concurrency

- The gateway supports multiple simultaneous client connections (no artificial limit in Phase 1).
- Each client connection maintains independent session state (active profile resolved per-connection from the token).
- Upstream connections are shared across client connections to the same server (one upstream connection per server, not per client).

---

## Session Lifecycle

```text
1. Client connects → gateway reads Authorization header → resolves token → determines profile
2. Client sends initialize → gateway responds with aggregated server capabilities
3. Client sends tool requests → gateway routes to upstream, returns results
4. Client disconnects → gateway closes SSE stream; upstream connections remain open
```

---

## Health & Readiness

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/_health` | GET | Returns `200 OK` with JSON status of all upstream servers |
| `/_ready` | GET | Returns `200 OK` when at least one server is connected, `503` otherwise |

### `/_health` Response

```json
{
  "status": "ok",
  "uptime": 3600,
  "servers": {
    "filesystem": { "status": "connected", "transport": "stdio", "restarts": 0 },
    "github":     { "status": "connected", "transport": "stdio", "restarts": 1 },
    "production-db": { "status": "error",  "transport": "http",  "lastError": "timeout" }
  }
}
```

Status values: `"connecting"` | `"connected"` | `"error"` | `"disabled"`

---

## Configuration Reference

```jsonc
{
  "port": 6317,           // TCP port. Default: 6317.
  "host": "127.0.0.1",    // Bind address. Default: 127.0.0.1.
  "defaultProfile": "default"
}
```
