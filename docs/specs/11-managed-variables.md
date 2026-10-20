# omni-mcp — Managed Variables

## Overview

Managed Variables provide exact `$NAME` / `${NAME}` substitution for server configuration.
Variables are either `secret` (default, write-only) or `plain` (readable). Tokens remain the
separate MCP client-to-profile authorization concept.

## Storage

```jsonc
// ~/.config/omni-mcp/variables.json
{
  "JIRA_TOKEN": { "type": "secret" },
  "API_BASE_URL": { "type": "plain", "value": "https://api.example.com" }
}
```

- The catalog path is fixed at `~/.config/omni-mcp/variables.json`.
- Secret values live in `~/.config/omni-mcp/secrets.json` or macOS Keychain.
- Plain values live only in `variables.json`.
- Config selects secret storage with:

```json
{
  "secretBackend": {
    "backend": "file",
    "keychainService": "omni-mcp"
  }
}
```

- Both files use atomic replacement, a `0700` parent directory, and `0600` file permissions.
- Names match `^[A-Za-z_][A-Za-z0-9_]*$`; values are non-empty strings.
- A catalog-less value already present in the secret backend is inferred as `secret`.
- A name may not have both a plain catalog value and a secret-backend value.

## Resolution

Config strings are references only when exactly `$NAME` or `${NAME}`. Embedded references are not
expanded. Lookup order is:

1. non-empty `process.env[NAME]`;
2. the catalog-selected store (`variables.json` for plain, active secret backend for secret);
3. unresolved-variable error (warning when the containing server is disabled).

`$$NAME` remains escaped literal `$NAME`.

## Visibility and Conversion

- Secret values are accepted on create/replace but never returned by API, CLI, logs, config reads,
  or UI. The create/replace form may reveal only the value currently being typed and remasks on
  blur/close.
- Plain values are returned by loopback management API and shown/editable in UI and CLI.
- Type conversion is explicit and transactional. `secret -> plain` internally copies the secret
  value into the catalog then deletes the backend value. `plain -> secret` does the inverse.
  Failures restore both stores.
- Deleting a referenced Variable is rejected.

## HTTP API

All routes are loopback-only.

| Method | Route | Behavior |
|---|---|---|
| `GET` | `/api/variables` | List metadata; include values only for plain Variables |
| `GET` | `/api/variables/:name` | Read one Variable |
| `PUT` | `/api/variables/:name` | Create/replace `{ type?, value }`; default `secret` |
| `PUT` | `/api/variables/:name/type` | Convert with `{ type }` |
| `DELETE` | `/api/variables/:name` | Delete when unreferenced |
| `POST` | `/api/variables/sync` | Validate stores and re-resolve config |
| `GET/POST` | `/api/variables/secret-backend` | Preview/migrate secret values only |
| `POST` | `/api/variables/import-keychain` | Import as secret |
| `GET/POST` | `/api/variables/migrate-inline` | Preview/apply inline literals as secrets |

There are no `/api/secrets` compatibility routes.

## CLI

```text
omni-mcp variables list [--json]
omni-mcp variables show <name> [--json]
omni-mcp variables set <name> [--type secret|plain] [--stdin]
omni-mcp variables convert <name> --type secret|plain [--yes]
omni-mcp variables delete <name> [--yes]
omni-mcp variables sync
omni-mcp variables import-keychain ...
omni-mcp variables migrate --secret-backend file|keychain
omni-mcp variables migrate --inline ...
```

Secret input uses a hidden prompt or stdin. Plain input uses a visible prompt or stdin. There is no
`secrets` command.

## Web UI

Route `/variables` displays Name, Type, Status, Value (plain only), usages, and actions.

- Add defaults to Secret and offers Secret / Plain text selection.
- Replace never pre-fills a secret; plain values are pre-filled.
- Convert requires confirmation.
- Keychain import and backend movement apply only to secret Variables.
- Inline env/JWT migration creates secret Variables.
- The UI has no `/secrets` route.

## Secret Backend Migration

File↔Keychain migration reads, verifies, moves, and rolls back only secret values. Plain entries and
`variables.json` are never moved. The preview count is `secretCount`, not total Variables.

## Technical Files

- `src/config/variable-store.ts` — typed catalog and facade
- `src/config/secret-store.ts` — file/Keychain secret backend
- `src/config/env.ts`, `src/config/loader.ts` — typed resolution
- `src/gateway/gateway.ts` — Variables API
- `src/cli/commands/variables.ts` — CLI
- `web/src/pages/VariablesPage.tsx` — UI

