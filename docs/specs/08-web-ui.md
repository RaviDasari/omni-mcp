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
| `/cli` | Opt managed servers into local CLI access and copy discovery commands |
| `/secrets` | Write-only secret names, backend, sync/import/migrate — see [11-managed-secrets.md](./11-managed-secrets.md) |

The desktop navbar keeps **Overview**, **MCP Servers**, and **CLI** visible. Logs, Playground,
Tokens, Secrets, Profiles, and IDE live in the kebab menu. The compact mobile menu contains all routes.

## JSON API

Same origin as the gateway. Mutating methods (`PUT`, `POST`, `DELETE`) are **loopback-only**. `GET /api/traffic-logs*` is also loopback-only because token names appear in the payload (see [09-traffic-logs.md](./09-traffic-logs.md)). Every `/api/secrets*` route is loopback-only for all methods and rejects other clients with `403 { "error": "This endpoint is only available from localhost" }` (see [11-managed-secrets.md](./11-managed-secrets.md)).

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | Version, bind, uptime, adapter status |
| GET | `/api/config` | Raw config: `$NAME` / `${NAME}` kept; literal env/JWT values redacted as `********` |
| PUT | `/api/config` | Full replace of the **raw** document; omitted/redacted secrets keep previous values; resolved values are never persisted |
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
| PUT | `/api/servers/:name/cli-enabled` | Enable or disable local CLI exposure |
| GET | `/api/cli/servers` | CLI-enabled server status and tool counts (loopback-only) |
| GET | `/api/cli/servers/:name/tools` | Tool schemas for a CLI-enabled server (loopback-only) |
| POST | `/api/cli/servers/:name/tools/call` | Invoke a CLI-enabled server tool (loopback-only) |
| GET | `/api/secrets` | Backend, count, and per-name set/unset with usages (loopback-only; no values) |
| GET | `/api/secrets/status` | Same secret payload as `GET /api/secrets` (loopback-only) |
| PUT | `/api/secrets/:name` | Create or replace a value from `{ value }` (loopback-only) |
| DELETE | `/api/secrets/:name` | Delete if unreferenced (loopback-only; `409` + usages otherwise) |
| POST | `/api/secrets/sync` | Validate the active backend and re-resolve the raw config (loopback-only) |
| POST | `/api/secrets/import-keychain` | Import one item by `{ service, account, name }` (loopback-only) |
| GET | `/api/secrets/backend?backend=` | Preview a file ↔ Keychain switch (loopback-only) |
| POST | `/api/secrets/backend` | Apply exclusive backend migration (loopback-only) |
| GET | `/api/secrets/migrate-inline` | Preview inline literal candidates and conflicts (loopback-only) |
| POST | `/api/secrets/migrate-inline` | Apply inline migration with optional `renames` (loopback-only) |

Binding `host` to `0.0.0.0` without authentication is unsafe. There is still no login UI.

## Secrets

The Secrets page manages the write-only store used by `$NAME` / `${NAME}` references. It never
displays a saved value. Operators add/replace/delete names, sync the active backend, migrate the
exclusive backend (`file` at `~/.config/omni-mcp/secrets.json` vs macOS Keychain), import one
external Keychain item by service and account, and move inline config literals into the store.
Delete is disabled while a variable is still referenced. The MCP Servers editor points operators at
`$NAME` instead of pasting literals. Contract: [11-managed-secrets.md](./11-managed-secrets.md).

## Direct MCP playground

The playground is a troubleshooting surface for an individual configured upstream. It uses the
server adapter directly: tool names are not prefixed, and gateway tokens and profile allow-lists
are intentionally bypassed. Both discovery and invocation endpoints are restricted to loopback
clients because tool schemas, arguments, and results may contain sensitive data and tool calls may
have side effects.

The selected server must be enabled and connected. The UI shows each tool's description and input
schema, accepts an arbitrary JSON object for arguments, and displays the complete MCP result,
including upstream `isError` responses and call duration.

## CLI management

The CLI page manages `servers.*.cli.enabled`, which defaults to false. This is a separate local
allow-list from profiles. Enabling it grants `omni-mcp cli` direct access to that server while the
gateway is running; global server enablement and connection health still apply.

## Development

```bash
npm --prefix web install
npm run dev:ui          # Vite on :5173, proxies /api to :6317
omni-mcp start --foreground
```

## Look

Confluence-blue CSS tokens and sticky navbar match the DeepWiki visual system. Do not add `/login` or AuthContext.
