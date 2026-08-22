# omni-mcp — MCP Traffic Logs

## Overview

The gateway records **metadata-only** records for each upstream `tools/call` so the local web UI can show which MCP tools ran, for which token/profile/server, and how often. Tool arguments and tool results are **never** stored. Records live on disk for at most **seven days** and are capped in size so the log cannot grow without bound.

This is separate from the daemon stderr file (`~/.omni-mcp/omni-mcp.log`) used by `omni-mcp start`.

## Functional Requirements

### Behavior
- On every MCP `tools/call` that the gateway attempts to route (including profile denials, unknown servers, and upstream failures), append one traffic record **after** the call completes or fails.
- Each record stores: UTC timestamp, token name, profile name, upstream server key, un-namespaced tool name, namespaced tool name (`server__tool`), duration in milliseconds, and outcome (`ok` | `error`). Optional: MCP error `code` only (integer). No argument objects, no result payloads, no upstream stdout, no error `message`/`data` strings (those can contain secrets or argument echoes).
- Do **not** log `tools/list`, `initialize`, or other MCP methods. Those are noisy and are not “which tool was called.”
- The web UI at `/logs` lists records and can filter by token, profile, server, and date range.
- A **Grouped** mode shows counts for the same filters, grouped by a chosen dimension (default: tool).
- Records older than `trafficLog.retentionDays` (default **7**) are deleted on a timer and again whenever a new record is written.
- Total on-disk size of traffic logs must not exceed `trafficLog.maxBytes` (default **5 MiB**). When a write would exceed the cap, drop the oldest records until the write fits. If a single record cannot fit even after emptying (should not happen given the schema), drop the new record and increment an in-memory `dropped` counter.
- Traffic log **read and write APIs** are **loopback-only**. Token names are credentials in this product; exposing them on a non-loopback bind would leak them.

### UI States
| State | Description |
|---|---|
| Default | Last 24 hours, all tokens/profiles/servers, **List** mode, newest first |
| Loading | Table/skeleton while `GET /api/traffic-logs` is in flight |
| Empty | Copy: “No tool calls in this range.” Filters remain usable |
| Error | `Alert` with the API `error` string; retry via Reload |
| Grouped | Table of group key + count instead of individual rows |
| Disabled | If `trafficLog.enabled` is `false`: copy “Traffic logging is off.” and a note to set `trafficLog.enabled` in config |

### User Interactions
| Interaction | Expected Result |
|---|---|
| Open **Logs** in the navbar | Navigate to `/logs` |
| Change Token / Profile / Server `Select` | Refetch with that filter (`""` / “All” means no constraint) |
| Set From / To dates | Refetch; invalid range (from > to) shows inline error and does not fetch |
| Switch Tabs **List** / **Grouped** | List uses `/api/traffic-logs`; Grouped uses `/api/traffic-logs/summary` |
| Change Group by (`Select`) | Refetch summary (`tool` \| `server` \| `token` \| `profile`) |
| Click Reload | Refetch current query |
| Click Clear logs | Confirm `AlertDialog`, then `DELETE /api/traffic-logs` (loopback); empty table |

### Edge Cases
- Call never reaches an adapter (bad namespace, unknown server, profile deny): still log `outcome: "error"` with `server`/`tool` parsed when possible; if the name has no `__`, `server` is `""` and `tool` is the raw `params.name`.
- Globally disabled or disconnected upstream: log `error` with `server` and `tool` filled in.
- Token resolved via unknown-token fallback: log the **effective** token name (`default` when that policy applies), not a placeholder.
- Missing `Authorization`: log `token` as `""` and the profile actually used (fallback or reject — reject means no `tools/call` is routed, so no record).
- Clock skew: timestamps are gateway `Date.now()` ISO-8601 UTC.
- Concurrent writes: serialize appends in-process (one gateway process).
- UI polling is **not** required in Phase 1; operator clicks Reload. (Live tail is out of scope.)
- `host` is `0.0.0.0`: `/api/traffic-logs*` still rejects non-loopback clients with `403`.

## Technical Specs

### Source Files

**Gateway**
- `src/gateway/traffic-log.ts` — append, query, summary, rotate, size cap
- `src/gateway/gateway.ts` — emit a record from `handleToolCall` (pass token + profile from `routeRequest`); register `/api/traffic-logs` routes
- `src/config/schema.ts` — `trafficLog` object
- `src/cli/commands/start.ts` — daemon dir already `~/.omni-mcp`; traffic files live under `~/.omni-mcp/traffic/`

**Web UI**
- `web/src/pages/LogsPage.tsx` — filters, list, grouped table
- `web/src/main.tsx` — route `/logs`
- `web/src/components/Navbar.tsx` — Logs nav item
- `web/src/lib/api.ts` — `fetchTrafficLogs`, `fetchTrafficSummary`, `clearTrafficLogs`
- `web/src/lib/types.ts` — `TrafficLogEvent`, `TrafficLogListResponse`, `TrafficLogSummaryResponse`

**Tests**
- `tests/gateway/traffic-log.test.ts` — append omits args/results; retention; maxBytes eviction; query filters
- `tests/gateway/api.test.ts` — loopback vs non-loopback; query params

### HTTP API

All three routes: **loopback-only**. Non-loopback → `403` `{ "error": "Writes are only allowed from localhost" }` (same message as other restricted `/api` routes, even for GET).

#### `GET /api/traffic-logs`
- **Triggered**: Logs page, List tab
- **Client restriction**: loopback-only
- **Query**:
  | Param | Type | Default | Notes |
  |---|---|---|---|
  | `from` | ISO-8601 UTC | now − 24h | Inclusive |
  | `to` | ISO-8601 UTC | now | Inclusive |
  | `token` | string | omitted | Exact token name |
  | `profile` | string | omitted | Exact profile name |
  | `server` | string | omitted | Exact server key |
  | `tool` | string | omitted | Exact un-namespaced tool name |
  | `offset` | int ≥ 0 | `0` | |
  | `limit` | int 1–200 | `100` | Hard max 200 |

- **Success (200)**:
```json
{
  "events": [
    {
      "ts": "2026-08-21T20:15:03.412Z",
      "token": "cursor",
      "profile": "admin",
      "server": "filesystem",
      "tool": "read_file",
      "namespacedTool": "filesystem__read_file",
      "durationMs": 18,
      "outcome": "ok"
    },
    {
      "ts": "2026-08-21T20:15:04.001Z",
      "token": "cursor",
      "profile": "admin",
      "server": "github",
      "tool": "create_pr",
      "namespacedTool": "github__create_pr",
      "durationMs": 2401,
      "outcome": "error",
      "errorCode": -32603
    }
  ],
  "total": 2,
  "dropped": 0
}
```
`total` is the count matching filters (not just the page). `dropped` is records discarded since process start due to the size cap (not persisted).

- **Error (400)**: invalid `from`/`to`/`limit`
```json
{ "error": "Invalid from timestamp" }
```

#### `GET /api/traffic-logs/summary`
- **Triggered**: Logs page, Grouped tab
- **Client restriction**: loopback-only
- **Query**: same filters as list (`from`, `to`, `token`, `profile`, `server`, `tool`) plus:
  | Param | Type | Default |
  |---|---|---|
  | `groupBy` | `tool` \| `server` \| `token` \| `profile` | `tool` |

When `groupBy=tool`, the key is `namespacedTool` (e.g. `filesystem__read_file`) so collisions across servers do not merge.

- **Success (200)**:
```json
{
  "groupBy": "tool",
  "groups": [
    { "key": "filesystem__read_file", "count": 42, "ok": 40, "error": 2 },
    { "key": "github__create_pr", "count": 3, "ok": 3, "error": 0 }
  ],
  "totalEvents": 45
}
```
`groups` sorted by `count` descending, then `key` ascending. No pagination; if more than **500** groups, return the top 500 and set `"truncated": true`.

#### `DELETE /api/traffic-logs`
- **Triggered**: Clear logs on the UI
- **Client restriction**: loopback-only
- **Success (200)**:
```json
{ "ok": true, "deleted": true }
```

### On-disk format

Directory: `~/.omni-mcp/traffic/` (create on first write).
Create the directory with mode `0700` and new JSONL files with mode `0600` because token names are credentials.

Files: `YYYY-MM-DD.jsonl` (UTC date of `ts`). One JSON object per line, same fields as API `events[]` items. No pretty-print.

Example line:

```json
{"ts":"2026-08-21T20:15:03.412Z","token":"cursor","profile":"admin","server":"filesystem","tool":"read_file","namespacedTool":"filesystem__read_file","durationMs":18,"outcome":"ok"}
```

**Rotation**
- On write and every **15 minutes**: delete files whose date is older than `retentionDays` (default 7). “Older” means file date `< today UTC − retentionDays`.
- After append, if the sum of file sizes in the directory is `> maxBytes`, delete oldest complete files first; if the newest file alone exceeds `maxBytes`, truncate that file from the **start** (drop oldest lines) until under cap.

**Privacy**
- Never write `params.arguments`, tool results, or error messages.
- Do not copy traffic lines into `omni-mcp.log`.

### Config

Added to `omni-mcp.config.json` (all optional; defaults apply when omitted):

```json
{
  "trafficLog": {
    "enabled": true,
    "retentionDays": 7,
    "maxBytes": 5242880
  }
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `enabled` | boolean | `true` | When `false`, no appends; GET returns `{ "events": [], "total": 0, "dropped": 0 }` |
| `retentionDays` | int 1–30 | `7` | Hard max 30 even if config is higher |
| `maxBytes` | int | `5242880` (5 MiB) | Minimum `65536`; maximum `52428800` (50 MiB) |

No environment-variable override in Phase 1 (`_TBD_` if operators later need `OMNI_MCP_TRAFFIC_LOG_ENABLED`).

### Libraries and Components to Reuse
| Name | Import Path | Purpose |
|---|---|---|
| `Button` | `@/components/ui/button` | Reload, Clear |
| `Select` | `@/components/ui/select` | Token, profile, server, group-by |
| `Table` | `@/components/ui/table` | List and grouped rows |
| `Tabs` | `@/components/ui/tabs` | List vs Grouped |
| `Card` | `@/components/ui/card` | Page layout |
| `Alert` | `@/components/ui/alert` | Errors and empty/disabled |
| `AlertDialog` | `@/components/ui/alert-dialog` | Confirm clear (install via shadcn CLI if missing) |
| `Badge` | `@/components/ui/badge` | `ok` / `error` outcome |
| `Label` | `@/components/ui/label` | Filter labels |
| `Input` | `@/components/ui/input` | From/To datetime-local (or Calendar + Date Picker if already installed) |
| `Skeleton` | `@/components/ui/skeleton` | Loading (install via shadcn CLI if missing) |

Filter option lists: token names, profile names, and server keys from `GET /api/config` (already loaded by the UI). Do not invent a separate metadata endpoint.

### Technical Constraints
- Default bind `127.0.0.1`; traffic log `/api` is loopback-only even for GET
- No login page
- English copy only; no i18n keys
- Do not bump `package.json` version by hand (semantic-release)
- Node `>=22.12`
- Do not store tool I/O; keep records to the fields listed above (on the order of ~200 bytes per call)
- Do not use SQLite or another database in Phase 1

## Open Questions

- [ ] Should `omni-mcp` CLI grow a `traffic` subcommand, or is the UI enough?
- [ ] Live auto-refresh interval (e.g. 10s) vs Reload-only — currently Reload-only
- [ ] Whether `durationMs` should include gateway queue time vs upstream-only (specified as wall time around `adapter.callTool`, including local deny paths as near-zero)
