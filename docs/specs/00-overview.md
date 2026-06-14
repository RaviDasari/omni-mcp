# omni-mcp — Project Overview

## Vision

`omni-mcp` is a client-side, TypeScript/Node.js proxy gateway that aggregates multiple MCP (Model Context Protocol) servers behind a single secure endpoint. AI clients such as Claude Desktop, Cursor, and VS Code connect to one URL and interact with all configured tools without needing to manage individual server connections.

## Goals

- Replace scattered per-IDE MCP config files with a single managed gateway.
- Provide secure, token-based access control so different agents see different tool sets.
- Protect local developer environments from cascading MCP server crashes.
- Remain lightweight enough to run as a background daemon on a developer machine.

## Non-Goals (Phase 1)

- No cloud or SaaS hosting.
- No team-shared deployments (Phase 2).
- No web management UI (Phase 2).
- No OAuth authentication (Phase 2).
- No tool-level granularity within a server (server-level allow/deny only).
- No multi-tenancy or enterprise compliance features (Phase 3).

---

## Architecture

```text
  [Claude / Cursor / VS Code / Local Apps]
              │
              ▼  HTTP MCP (localhost:6317)
  ┌─────────────────────────────────────────┐
  │               omni-mcp                  │
  │                                         │
  │  ┌───────────┐      ┌────────────────┐  │
  │  │  Token &  │      │ Profile-Based  │  │
  │  │  Auth     │ ───► │ Tool Filter    │  │
  │  └───────────┘      └───────┬────────┘  │
  │                             │           │
  │             ┌───────────────┼───────┐   │
  │             ▼               ▼       ▼   │
  │       [Server A]      [Server B]  [...]  │
  │       (stdio)         (http+jwt)        │
  └─────────────────────────────────────────┘
              │                  │
       [Local MCP Process]  [Remote MCP URL]
```

### Key Design Principles

1. **Single endpoint** — all clients connect to `http://localhost:6317` (MCP Streamable HTTP transport).
2. **Token-driven profiles** — the ****** presented by the client determines which profile (and therefore which tools) are active.
3. **Isolation** — each upstream server is independently managed; a crash in one server does not affect others.

---

## Phases

### Phase 1 — Single Client-Side Proxy (current)
- TypeScript/Node.js daemon on developer machine.
- Local HTTP MCP gateway on port `6317`.
- Token + profile access control.
- `stdio` and `http` upstream transport bridging.
- CLI management (`start`, `status`, `stop`).
- Crash isolation and auto-restart.

### Phase 2 — Team Cloud Service (future)
- Standalone team-shared deployment.
- Web management UI for profile/token administration.
- Load balancing across shared MCP server pools.
- OAuth support.

### Phase 3 — Enterprise SaaS (future)
- Multi-tenant platform with regional proxies.
- Enterprise compliance toggles.
- AI-driven tool discovery.

---

## Spec Index

| File | Topic |
|------|-------|
| [01-configuration.md](./01-configuration.md) | Config file schema and environment variable resolution |
| [02-token-auth.md](./02-token-auth.md) | Token model, profile binding, precedence rules |
| [03-proxy-gateway.md](./03-proxy-gateway.md) | HTTP gateway, routing, aggregated tool exposure |
| [04-transport-bridging.md](./04-transport-bridging.md) | stdio and HTTP upstream transport adapters |
| [05-resilience.md](./05-resilience.md) | Crash isolation, restart policy, error responses |
| [06-cli.md](./06-cli.md) | CLI commands, flags, and output format |
| [07-ide-integration.md](./07-ide-integration.md) | IDE setup, auto-discovery, per-client profiles |
