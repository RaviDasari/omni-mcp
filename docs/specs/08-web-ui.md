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
| `/profiles` | Server allow-lists and per-tool deny policies (keep `default`) |
| `/tokens` | Token-to-profiles mapping; distinct from managed Variables |
| `/ide` | Copy-paste IDE snippets |
| `/logs` | MCP tool-call traffic (filters, grouped counts) — see [09-traffic-logs.md](./09-traffic-logs.md) |
| `/playground` | Directly list and invoke tools on one configured upstream server |
| `/cli` | Opt managed servers into local CLI access and copy discovery commands |
| `/variables` | Secret and plain managed Variables — see [11-managed-variables.md](./11-managed-variables.md) |

The desktop navbar keeps **Overview**, **MCP Servers**, and **CLI** visible. Logs, Playground,
Tokens, Variables, Profiles, and IDE live in the kebab menu. The compact mobile menu contains all routes.

## JSON API

Same origin as the gateway. Mutating methods (`PUT`, `POST`, `DELETE`) are **loopback-only**.
Sensitive reads are loopback-only too: config, server/profile/token metadata, IDE snippets, traffic
logs, Variables, direct Playground tools, and managed CLI routes. They reject non-loopback clients
with `403 { "error": "This endpoint is only available from localhost" }`. Health/readiness remain
available for probes. JSON request bodies are capped at 1 MiB; oversized requests return `413`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/health` | Version, bind, uptime, adapter status |
| GET | `/api/config` | Loopback-only raw config: `$NAME` / `${NAME}` kept; literal env/JWT values redacted as `********` |
| PUT | `/api/config` | Full replace of the **raw** document; omitted/redacted secrets keep previous values; resolved values are never persisted |
| PUT | `/api/servers/:name` | Upsert one server, write file, hot-apply adapters |
| PUT | `/api/servers/:name/enabled` | Globally enable or disable a server and hot-apply |
| DELETE | `/api/servers/:name` | Remove server and allow-list entries |
| PUT | `/api/profiles/:name` | Upsert profile |
| DELETE | `/api/profiles/:name` | Cannot delete `default` |
| PUT | `/api/profiles/:name/servers/:server/tools/:tool/enabled` | Toggle profile tool policy |
| POST | `/api/profiles/:name/apply-deny-tools` | Copy one server policy to target profiles |
| PUT | `/api/tokens/:name` | Upsert token |
| DELETE | `/api/tokens/:name` | Cannot delete `default` |
| POST | `/api/reload` | Reload from disk (same effect as SIGHUP) |
| GET | `/api/ide-snippets?token=` | Loopback-only IDE JSON snippets |
| GET | `/api/traffic-logs` | Tool-call metadata list (loopback-only; see spec 09) |
| GET | `/api/traffic-logs/summary` | Grouped counts (loopback-only; see spec 09) |
| DELETE | `/api/traffic-logs` | Purge traffic files (loopback-only; see spec 09) |
| GET | `/api/servers/:name/tools` | Raw tool list for one connected server (loopback-only) |
| POST | `/api/servers/:name/tools/call` | Direct tool call with `{ tool, arguments }` (loopback-only) |
| PUT | `/api/servers/:name/tools/:tool/enabled` | Toggle global tool availability |
| PUT | `/api/servers/:name/cli-enabled` | Enable or disable local CLI exposure |
| GET | `/api/cli/servers` | CLI-enabled server status and tool counts (loopback-only) |
| GET | `/api/cli/servers/:name/tools` | Tool schemas for a CLI-enabled server (loopback-only) |
| POST | `/api/cli/servers/:name/tools/call` | Invoke a CLI-enabled server tool (loopback-only) |
| GET | `/api/variables` | Typed metadata and plain values; secret values omitted |
| GET | `/api/variables/:name` | Read one Variable |
| PUT | `/api/variables/:name` | Create or replace `{ type, value }` |
| PUT | `/api/variables/:name/type` | Convert with `{ type }` |
| DELETE | `/api/variables/:name` | Delete if unreferenced |
| POST | `/api/variables/sync` | Validate stores and re-resolve config |
| POST | `/api/variables/import-keychain` | Import one secret Variable |
| GET/POST | `/api/variables/secret-backend` | Preview/apply secret-only backend migration |
| GET/POST | `/api/variables/migrate-inline` | Preview/apply inline migration as secrets |

Binding `host` to `0.0.0.0` without authentication is unsafe. There is still no login UI.

## IDE snippets

The IDE page renders whatever `GET /api/ide-snippets` returns: one card per client (Cursor, VS Code,
Claude Code, Claude Desktop, Windsurf) plus a `curl` example. Each card shows the client's brand mark,
its config path, any platform-specific alternates from `altPaths`, and the snippet in a dark
`CodeBlock` with JSON syntax highlighting and a copy button. Snippet content is owned by
`src/ide/snippets.ts`, not the UI — see [07-ide-integration.md](./07-ide-integration.md).

## Server editor

The Add/Edit server dialog toggles between a field form and a JSON editor. The JSON editor
(`web/src/components/ui/json-editor.tsx`) highlights tokens, numbers lines, marks the failing line
while typing, and indents with Tab / Shift+Tab. **Format** pretty-prints with 2-space indent and
unwraps a pasted `{"mcpServers": {"name": {...}}}` (or `"servers"`) block down to the single server
object, filling in the name and inferring `type` from `url` / `command` when absent. Save applies the
same unwrapping.

## Variables

The Variables page manages secret and plain values used by `$NAME` / `${NAME}` references. Plain
values are readable and editable. Secret values are write-only after creation, while the current
input can be revealed during create/replace. Type conversion is confirmed and transactional.
Keychain sync and backend migration affect secret Variables only. Contract:
[11-managed-variables.md](./11-managed-variables.md).

## Direct MCP playground

The playground is a troubleshooting surface for an individual configured upstream. It uses the
server adapter directly: tool names are not prefixed, and gateway tokens and profile allow-lists
are intentionally bypassed. Both discovery and invocation endpoints are restricted to loopback
clients because tool schemas, arguments, and results may contain sensitive data and tool calls may
have side effects.

The selected server must be enabled and connected. The UI shows each tool's description and input
schema, accepts an arbitrary JSON object for arguments, and displays the complete MCP result,
including upstream `isError` responses and call duration.

Globally disabled tools are hidden and blocked in Playground. Profile denies do not apply because
Playground remains a direct troubleshooting surface. The Servers page manages both layers and can
save or apply profile policy as specified in
[13-tool-policies-and-tokens.md](./13-tool-policies-and-tokens.md).

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
