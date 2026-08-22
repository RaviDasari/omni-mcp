# omni-mcp — Web UI

## Overview

A local management UI is served from the gateway with **no login page**. After `omni-mcp start`, open:

```
http://127.0.0.1:6317/
```

The UI is a Vite + React + shadcn (new-york) SPA. Production assets live in `dist/ui` and are copied there by `npm run build`.

## Routes

| Path | Purpose |
|------|---------|
| `/` | Overview: health, uptime, server status, global enable/disable, reload |
| `/servers` | Add, clone, edit, remove, globally toggle, and browse upstream servers in tile or list view |
| `/profiles` | Profile allow-lists (keep `default`) |
| `/tokens` | Token-to-profile mapping (names are secrets) |
| `/ide` | Copy-paste IDE snippets |
| `/logs` | MCP tool-call traffic (filters, grouped counts) — see [09-traffic-logs.md](./09-traffic-logs.md) |
| `/playground` | Directly list and invoke tools on one configured upstream server |

## JSON API

Same origin as the gateway. Mutating methods (`PUT`, `POST`, `DELETE`) are **loopback-only**. `GET /api/traffic-logs*` is also loopback-only because token names appear in the payload (see [09-traffic-logs.md](./09-traffic-logs.md)).

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | Version, bind, uptime, adapter status |
| GET | `/api/config` | Config with env/JWT values redacted as `********` |
| PUT | `/api/config` | Full replace; omitted/redacted secrets keep previous values |
| PUT | `/api/servers/:name` | Upsert one server, write file, hot-apply adapters |
| PUT | `/api/servers/:name/enabled` | Globally enable or disable a server and hot-apply |
| DELETE | `/api/servers/:name` | Remove server and allow-list entries |
| PUT | `/api/profiles/:name` | Upsert profile |
| DELETE | `/api/profiles/:name` | Cannot delete `default` |
| PUT | `/api/tokens/:name` | Upsert token |
| DELETE | `/api/tokens/:name` | Cannot delete `default` |
| POST | `/api/reload` | Reload from disk (same effect as SIGHUP) |
| GET | `/api/ide-snippets?token=` | IDE JSON snippets |
| GET | `/api/traffic-logs` | Tool-call metadata list (loopback-only; see spec 09) |
| GET | `/api/traffic-logs/summary` | Grouped counts (loopback-only; see spec 09) |
| DELETE | `/api/traffic-logs` | Purge traffic files (loopback-only; see spec 09) |
| GET | `/api/servers/:name/tools` | Raw tool list for one connected server (loopback-only) |
| POST | `/api/servers/:name/tools/call` | Direct tool call with `{ tool, arguments }` (loopback-only) |

Binding `host` to `0.0.0.0` without authentication is unsafe. There is still no login UI.

## Direct MCP playground

The playground is a troubleshooting surface for an individual configured upstream. It uses the
server adapter directly: tool names are not prefixed, and gateway tokens and profile allow-lists
are intentionally bypassed. Both discovery and invocation endpoints are restricted to loopback
clients because tool schemas, arguments, and results may contain sensitive data and tool calls may
have side effects.

The selected server must be enabled and connected. The UI shows each tool's description and input
schema, accepts an arbitrary JSON object for arguments, and displays the complete MCP result,
including upstream `isError` responses and call duration.

## Development

```bash
npm --prefix web install
npm run dev:ui          # Vite on :5173, proxies /api to :6317
omni-mcp start --foreground
```

## Look

Confluence-blue CSS tokens and sticky navbar match the DeepWiki visual system. Do not add `/login` or AuthContext.
