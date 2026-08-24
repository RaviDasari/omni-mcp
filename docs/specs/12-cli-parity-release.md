# omni-mcp — CLI Parity and Release Contract

## Overview

This release brings the CLI to parity with the local management UI while preserving scripts that
use the existing top-level commands. Management commands use a safe hybrid model: they operate on
the running gateway only when it is serving the selected config; otherwise they operate on that
config file offline.

## Command surface

All resource groups support human-readable output by default and stable, newline-terminated JSON
with `--json`. Errors go to stderr and produce a nonzero exit code; JSON mode must not mix prose
into stdout.

| Group | Required operations |
|---|---|
| `server` | `list`, `show`, `add`, `update`, `remove`, `clone`, `enable`, `disable`, `cli-enable`, `cli-disable` |
| `profile` | `list`, `show`, `create`, `update`, `delete` |
| `token` | `list`, `show`, `create`, `update`, `delete`, `enable`, `disable` |
| `config` | `path`, `show`, `apply`, `validate`, `reload` |
| `logs` | `list`, `summary`, `clear`, with the traffic-log filters and pagination from spec 09 |
| `tools` | `list`, `show`, `call` against the direct Playground API |

Structured create/update/apply/call input accepts JSON from a flag for small values and from a file
or stdin for lossless scripting. Secret values remain excluded from argv; spec 11 governs secret
input.

### Compatibility aliases

The existing commands remain supported for the compatibility window:

- `add <name>` → `server add <name>`
- `remove <name>` → `server remove <name>`
- `validate` → `config validate`
- `reload` → `config reload`
- `ide-snippets`, `start`, `stop`, `restart`, and `status` retain their names
- `cli` remains the managed, explicitly opted-in tool interface; it is not an alias for `tools`
- `secrets` retains its group and gains parity behavior described below

Aliases use the same validation, output, exit codes, target selection, and confirmation rules as
their canonical commands.

## Hybrid live/offline behavior

1. Resolve the selected config from `--config`; when omitted, use
   `~/.config/omni-mcp/config.json`. Normalize it to an absolute path.
2. Discover a running local gateway using lifecycle metadata and `/_health`, including its actual
   host/port. The health payload reports the gateway's normalized absolute `configPath`.
3. Use the loopback management API only when the gateway is reachable **and** its normalized
   absolute `configPath` exactly matches the normalized absolute selected path.
4. If no gateway is reachable, or it serves a different config, read and mutate the selected file
   offline. Validate the complete raw document before an atomic same-directory replacement.
5. Offline writes state that the running process was not changed and that reload or restart is
   required. A config-path mismatch must be explicit; the CLI must never silently mutate one config
   through a gateway serving another.

Read-only commands follow the same target rule so `status`, config output, resource lists, custom
ports, and custom config files cannot accidentally report the default instance.

## Mutation safety and confirmation

- Destructive operations (`server remove`, `profile delete`, `token delete`, `logs clear`, secret
  deletion, and replacement-style config apply) prompt on an interactive TTY.
- `--yes` confirms non-interactively. Without a TTY and without `--yes`, abort without changing
  state.
- The protected `default` profile and token cannot be deleted.
- Profile/token/server references are validated as one config document. Server deletion removes
  that server from profile allow lists; other invalid cross-references abort.
- Live mutations use loopback API validation and hot application. Offline mutations preserve raw
  `$NAME` / `${NAME}` references and literal-secret redaction rules.

## Reload contract

`config reload` and the `reload` alias reload the selected file into a matching running gateway.
Reload validates and resolves the whole config before changing live state. It hot-applies server
changes: removed/disabled adapters disconnect, added/enabled adapters connect, and adapters whose
connection-affecting configuration changed are disconnected and recreated. Profiles, tokens,
default profile, traffic-log settings, CLI enablement, and secrets are refreshed without restarting
the gateway process. Listener `host` and `port` changes require restart.

If validation or resolution fails, the prior in-memory config and usable adapters remain active.

## Import and secrets parity

`init --import` is functional, not documentation-only. It discovers supported Cursor, VS Code, and
Claude Desktop user/workspace config locations, silently skips missing files, imports stdio and
HTTP server definitions, resolves deterministic name collisions without dropping entries, and
writes the normal default profile/token structure. Existing output still requires explicit
overwrite confirmation (`--yes`).

The `secrets` group preserves write-only values and no-value-in-argv behavior. In addition to
list/status, set, delete, sync, external Keychain import, inline migration, and backend migration,
the CLI exposes the same backend migration preview/apply distinction as the UI/API. Live secret
sync/migration re-resolves and hot-applies adapters; offline operations target only the selected
config/store and clearly report when reload is needed. JSON output contains metadata only.

## Direct Playground versus managed CLI

- `omni-mcp tools …` uses `/api/servers/:name/tools` and `/tools/call`, matching the web
  Playground. It is loopback-only, can inspect/call any globally enabled connected server, and does
  not require `servers.<name>.cli.enabled`.
- `omni-mcp cli …` uses `/api/cli/servers…`, requires explicit `cli.enabled: true`, retains
  schema-derived flags, discovery/usage features, and skill installation from spec 10.
- Both reuse the running gateway adapters. Neither starts a second upstream process. Direct
  Playground calls and managed CLI calls remain distinguishable in behavior and traffic metadata.

## Gateway release hardening

- JSON request bodies for `/api/*` and `/mcp` are limited to **1 MiB (1,048,576 bytes)**. Oversized
  bodies return HTTP `413` and the connection is safely drained or closed; malformed JSON remains
  `400`.
- All management mutations are loopback-only. Sensitive management reads are also loopback-only,
  including config, server/profile/token metadata, IDE snippets, traffic logs, secrets, direct
  Playground tools, and managed CLI routes. Public health/readiness remain available for probes.
- The default bind is `127.0.0.1`. Any non-loopback bind prints a prominent warning that MCP is
  network-accessible and that binding without authentication is unsafe; loopback management
  restrictions still apply.
- For compatibility, omitted `security.unknownTokenPolicy` continues to default to
  `"fallback-to-default"`. New templates may explicitly choose `"reject"`; changing the schema
  default is a separate breaking change.
- Runtime/CLI/status versions come from the package build version. CI and release gates run root
  typecheck/tests, web lint, production build, and package smoke checks; semantic-release alone
  changes package versions.

## Technical constraints

- Node.js `>=22.12`
- Config default: `~/.config/omni-mcp/config.json`; secrets default:
  `~/.config/omni-mcp/secrets.json`
- No secret value in CLI/API output, logs, traffic metadata, process arguments, or rewritten config
- No source compatibility break for the aliases listed above in this release
