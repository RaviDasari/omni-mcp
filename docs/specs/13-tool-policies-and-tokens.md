# omni-mcp — Tool Policies and Tokens

## Overview

Tool availability has two layers: global server kill-switches and per-profile deny lists. A Token
may combine multiple profiles; effective access is their maximum privilege. Global disables always
win.

## Global policy

Each server may define upstream tool names in `disabledTools`. These tools are hidden and blocked
for MCP clients, Playground, and managed CLI. Stale names are harmless, and policy-only changes do
not restart the upstream adapter.

## Profile policy

Profiles may define `denyTools: Record<server, tool[]>`. Tools are opt-out: new upstream tools appear
automatically unless denied. A profile deny affects MCP clients only; Playground and managed CLI
bypass profiles while still honoring global disables.

## Multi-profile Tokens

The canonical Token field is a non-empty `profiles: string[]`.

1. Allowed servers are the union of assigned profile allow lists.
2. A tool is allowed when at least one assigned profile grants its server and does not deny it.
3. `servers.*.disabledTools` is subtracted last.

Traffic logs use the lexicographically sorted profile names joined with `+`.

## API

- `PUT /api/servers/:name/tools/:tool/enabled`
- `PUT /api/profiles/:name/servers/:server/tools/:tool/enabled`
- `POST /api/profiles/:name/apply-deny-tools`
- `PUT /api/tokens/:name` with `{ profiles: string[] }`
- `GET /api/servers/:name/tools` includes global `enabled` and `deniedByProfiles`

Disabled or denied tools are omitted from `tools/list`; direct `tools/call` returns `-32601`.

## CLI and UI

- `omni-mcp server disable-tool|enable-tool <server> <tool>`
- `omni-mcp profile disable-tool|enable-tool <profile> <server> <tool>`
- `omni-mcp profile apply-tools <source> --to <profiles...> --server <server>`
- `omni-mcp token set <name> --profiles <profiles...>`

The Servers page exposes Global and Profile policy views, save-as-profile, and apply-to-profiles.
The Tokens page provides multi-profile selection. Profile deletion is rejected while any Token
references it.

