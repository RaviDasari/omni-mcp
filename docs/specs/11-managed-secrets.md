# omni-mcp — Managed Secrets

## Overview

omni-mcp stores secret and variable **values** outside the config file. Config references them with
exact `$NAME` or `${NAME}` strings. At load and reload, the gateway resolves references into a
separate runtime document used by adapters, while the **raw** document (with references intact) is
what `/api` returns and what is written back to disk.

The default store is the file `~/.config/omni-mcp/secrets.json`. On macOS, operators may switch to
an exclusive Keychain backend. Only one backend is active at a time.

## Functional Requirements

### Behavior
- A config string is a reference only when it is **exactly** `$NAME` or `${NAME}`. Embedded
  expansion such as `Bearer-$TOKEN` is not performed.
- Lookup order per reference: `process.env[NAME]` when non-empty, then the active store. A store
  value is used when the environment value is unset or empty.
- A name that resolves to nothing in both places is a load-time error. `omni-mcp start`,
  `omni-mcp validate`, and reload all fail with the config path and variable name.
- Store values are **write-only**. No CLI command, `/api` route, or UI view returns a saved value.
- File-backend values live only in `~/.config/omni-mcp/secrets.json`. Keychain-backend values live
  only as generic-password items under the configured Keychain service. Backend migration copies
  and verifies each value in the destination before deleting the source.
- Literal secrets in config (stdio `env` values, HTTP `auth.token`) stay valid so they can be
  migrated into the store and replaced with `$NAME`.

### Syntax

| Form | Example | Variable |
|------|---------|----------|
| `$NAME` | `"$JIRA_TOKEN"` | `JIRA_TOKEN` |
| `${NAME}` | `"${JIRA_TOKEN}"` | `JIRA_TOKEN` |

`NAME` must match `^[A-Za-z_][A-Za-z0-9_]*$` (`SECRET_NAME_PATTERN`).

A string starting with `$$` is not a reference: the leading `$$` becomes a single `$` and the rest
of the string is kept unchanged.

- `"$$PATH"` → literal `$PATH`
- `"$PATH extra"` → not a reference (kept as-is)
- `"Bearer-$TOKEN"` → not a reference (kept as-is)

Resolution walks every JSON string in the config document. Object **keys** are never resolved.

### Secret store configuration

Optional top-level `secretStore` in the config file:

```jsonc
{
  "secretStore": {
    // Optional. Default: "file"
    "backend": "file", // or "keychain" (macOS only)

    // Optional. Default: "omni-mcp"
    "keychainService": "omni-mcp"
  }
}
```

| Field | Default | Rules |
|-------|---------|-------|
| `backend` | `"file"` | `"file"` or `"keychain"`. Any other value fails schema validation. |
| `keychainService` | `"omni-mcp"` | Fixed literal. The dedicated omni-mcp Keychain namespace. |

There is **no** configurable secrets path. The file backend always uses `DEFAULT_SECRETS_PATH`
(`~/.config/omni-mcp/secrets.json`). A `filePath` override exists only as an injectable test option
(`SecretStoreOptions`), not as config.

`secretStore` is not secret and is returned unredacted in `GET /api/config`.

### File backend

- Path is fixed: `~/.config/omni-mcp/secrets.json`.
- Shape is a flat JSON object of non-empty strings: `{ "JIRA_TOKEN": "…" }`.
- On write: the parent directory is created and `chmod`ed to `0700`; the payload is written to a
  temp file in the same directory with mode `0600`, `chmod`ed, then `rename`d over the target and
  `chmod`ed `0600`. The temp file is removed in a `finally` block. There is no explicit `fsync`.
- On read: invalid JSON, a non-object/array root, an invalid variable name, or a non-string/empty
  value throws. Nothing is partially applied.
- A missing file is an empty store, not an error.

### Keychain backend (macOS exclusive)

- Values are generic-password items: **service** = `secretStore.keychainService` (default
  `omni-mcp`), **account** = the variable name.
- The managed name set is stored in a reserved index item under the same service with account
  `__omni_mcp_index__`, whose password is a JSON array of names. omni-mcp never enumerates the
  user's Keychain.
- The provider shells out to `/usr/bin/security` (`find-generic-password`,
  `add-generic-password -U`, `delete-generic-password`) and is injectable for tests
  (`SecretStoreOptions.runSecurity`). Exit statuses `44`/`45` mean "not found".
- `set` and `delete` restore the previous password if the index write fails.
- Constructing the store on a non-macOS platform throws
  `macOS Keychain backend is only available on macOS`. This surfaces as a load error (not a schema
  error) when the config selects `keychain` off macOS.

### Explicit external Keychain import

Importing a password that omni-mcp does not already manage always requires **service**, **account**,
and a destination variable **name**. The value is written into the active store under that name.
No bulk import exists.

Because the reader validates the account against `SECRET_NAME_PATTERN`, the source Keychain
**account** must itself match `^[A-Za-z_][A-Za-z0-9_]*$`.

### Sync

Sync validates and refreshes from the **active** backend; it is not Keychain-only.

- CLI `secrets sync` reads the active store and reports how many variables it holds. A malformed
  file store or a Keychain failure surfaces as an error.
- `POST /api/secrets/sync` re-applies the raw config, which re-resolves references (environment
  first, then store) and hot-applies adapters, then returns fresh secret metadata.

### Write-only and redaction

- Metadata exposed per variable: `name`, `set` (a non-empty value exists in the store), and
  `usages` — an array of `{ path, server? }` objects such as
  `{ "path": "servers.jira.env.JIRA_TOKEN", "server": "jira" }`.
- Listings include names that are only referenced by config (`set: false`) as well as names that
  exist only in the store.
- `GET /api/config` keeps exact `$NAME` / `${NAME}` strings and replaces **literal** stdio `env`
  values and HTTP `auth.token` values with `********`.
- Store values never appear in logs, `omni-mcp status`, traffic records, or `--json` output.

### Inline config migration

Moves literal server secrets into the active store and rewrites the fields to `$NAME`.

- stdio `servers.<name>.env.<KEY>` → variable from `KEY`, uppercased with every character outside
  `[A-Z0-9_]` replaced by `_`, prefixed with `_` if it does not start with a letter or underscore.
- HTTP `servers.<name>.auth.token` → the same normalization applied to `<server>_TOKEN`
  (`production-db` → `PRODUCTION_DB_TOKEN`).
- Values that are already references, or equal to the redaction placeholder `********`, are skipped.
- A **conflict** is a variable name reached by two literals with different values, or a name that
  already holds a different value in the store. Conflicts must be resolved with explicit renames
  before apply.
- Apply is transactional: store writes are rolled back to their previous values if the config write
  fails.

### Backend migration

`file` ↔ `keychain` (`migrateSecretStore`):

1. Read every name/value from the source.
2. Write each into the destination and verify by reading it back.
3. On any failure, restore the destination's previous values and abort.
4. Delete the source values. If that fails, restore both source and destination.
5. Persist the new `secretStore.backend` in the raw config. If the config write fails, migrate back.

Requesting the backend that is already active is a no-op that reports `migrated: 0`.

### Delete rules

Deleting a name that the raw config still references is rejected (`409` on the API, an error on the
CLI) and reports the usages. Deleting a name that is not in the store reports "not found" (`404`).
Environment-only overrides are not usages.

### CLI

```bash
omni-mcp secrets list [--json] [--config <path>]
omni-mcp secrets status [--json] [--config <path>]
omni-mcp secrets get-status [--json] [--config <path>]
omni-mcp secrets set <name> [--stdin] [--config <path>]
omni-mcp secrets delete <name> [--config <path>]
omni-mcp secrets sync [--config <path>]
omni-mcp secrets import-keychain [name] --service <service> --account <account> [--name <name>] [--config <path>]
omni-mcp secrets migrate --backend file|keychain [--config <path>]
omni-mcp secrets migrate --inline [--preview] [--apply] [--rename NAME=NEW_NAME ...] [--json] [--config <path>]
```

| Command / flag | Effect |
|---|---|
| `list` | Backend, `keychainSupported`, and one row per variable with set/unset and usage count |
| `status`, `get-status` | Aliases of `list` (identical output) |
| `set <name>` | Create or replace. Value comes from a hidden TTY prompt, or from stdin with `--stdin` or when stdin is not a TTY. There is no value flag or argument |
| `delete <name>` | Error if the config references the name; error if it is not in the store |
| `sync` | Validate the active backend and report the variable count |
| `import-keychain` | Destination name from the positional argument or `--name`; `--service` and `--account` are required |
| `migrate --backend` | Exclusive backend migration, then rewrite `secretStore.backend` in the config. Already-active backend prints a no-op message |
| `migrate --inline` | Without `--apply`, prints the preview (`path -> $NAME`, or JSON with `--json`). With `--apply`, writes store values and rewrites config fields |
| `--rename NAME=NEW_NAME` | Repeatable. Applied to inline candidates before conflict detection |
| `--json` | Metadata only (`list`/`status`/`get-status`, and inline preview) |

Inline conflicts abort with `Inline migration has variable-name collisions: …`. `--preview` is
accepted and is the default when `--apply` is absent.

Human output shows names and statuses only. Values are never echoed.

### UI

Route `/secrets`, reachable from the navbar kebab menu (and the mobile menu), not a primary tab.

| State | Description |
|---|---|
| Loading | `Loading…` while `GET /api/secrets` is in flight |
| Default | Backend card with a `backend` badge plus one card per variable: name, `set`/`unset` badge, usage paths or “Not referenced by the current config” |
| Empty | Card with “No variables configured.” |
| Error | Destructive `Alert` with the API error text (load failures, invalid input, migration failures) |
| Keychain unsupported | Import button hidden; the migrate button is disabled while the backend is `file` |
| Busy | Action buttons disabled while a mutation is in flight |

| Interaction | Expected Result |
|---|---|
| **Add variable** | Dialog with name + password input → `PUT /api/secrets/:name`. Client-side check enforces the name pattern and a non-empty value |
| **Replace** on a card | Same dialog pre-filled with the name and an empty value |
| Delete (trash icon) | `window.confirm`, then `DELETE /api/secrets/:name`. Disabled when the variable has usages |
| **Sync** | `POST /api/secrets/sync` |
| **Move to macOS Keychain / secrets.json** | `GET /api/secrets/backend?backend=…` preview, `window.confirm` with the count, then `POST /api/secrets/backend` |
| **Import Keychain item** | Dialog with name, service, account → `POST /api/secrets/import-keychain` (shown only when `keychainSupported`) |
| **Migrate inline config** | `GET /api/secrets/migrate-inline`; empty candidates show an error message; each conflict is resolved through `window.prompt`; `window.confirm` then `POST /api/secrets/migrate-inline` |
| Editing a server on `/servers` | Field labels steer operators to `$NAME` references managed on the Secrets page |

Confirmations use native `window.confirm` / `window.prompt` rather than `AlertDialog`. Values are
never rendered back.

### Edge Cases
- All `/api/secrets*` routes reject non-loopback clients with `403`, including `GET`.
- Setting an existing name replaces it without reading the old value.
- `$$`-escaped strings are not counted as usages.
- A malformed file store surfaces as a `500` with the parse/validation message; the UI shows it in
  the error `Alert`.
- Selecting `keychain` off macOS fails when the store is constructed, so config load reports the
  unsupported-platform message.
- References in the raw config survive UI/API writes: `mergeSecrets` restores omitted or
  `********` fields from the previous document, so resolved values are never persisted.

## Technical Specs

### Source Files

**Gateway / config**
- `src/config/schema.ts` — `secretStore` (`backend`, `keychainService`)
- `src/config/secret-store.ts` — `SecretStore`, `FileSecretStore`, `KeychainSecretStore`,
  `createSecretStore`, `migrateSecretStore`, `assertSecretName`, `SECRET_NAME_PATTERN`
- `src/config/env.ts` — exact `$NAME` / `${NAME}` / `$$` resolution with env-then-store lookup
- `src/config/secrets.ts` — `secretReferenceName`, `collectSecretUsages`, `redactConfig`,
  `mergeSecrets`
- `src/config/loader.ts` — `resolveConfig` builds the store, resolves, and returns both `config`
  and `rawConfig`
- `src/config/write.ts` — raw config persistence
- `src/cli/config-path.ts` — `DEFAULT_SECRETS_PATH`
- `src/gateway/gateway.ts` — `/api/secrets*` routes, `secretPayload`, inline candidates, conflicts

**CLI**
- `src/cli/commands/secrets.ts` — `registerSecretsCommand`
- `src/cli/index.ts` — registers the `secrets` command

**Web UI**
- `web/src/pages/SecretsPage.tsx`
- `web/src/pages/ServersPage.tsx` — `$NAME` guidance on env/JWT fields
- `web/src/main.tsx` — route `/secrets`
- `web/src/components/Navbar.tsx` — Secrets in the secondary (kebab) links
- `web/src/lib/api.ts` — `fetchSecrets`, `putSecret`, `deleteSecret`, `syncSecrets`,
  `migrateSecretBackend`, `previewSecretBackendMigration`, `importKeychainSecret`,
  `fetchInlineSecretMigration`, `applyInlineSecretMigration`
- `web/src/lib/types.ts` — `SecretUsage`, `SecretMetadata`, `SecretsResponse`

**Tests**
- `tests/config/secret-store.test.ts` — file/Keychain stores, permissions, migration/rollback
- `tests/config/env.test.ts` — reference syntax, precedence, `$$`
- `tests/config/secrets.test.ts` — reference detection, usages, redaction, merge
- `tests/config/loader.test.ts` — raw vs resolved config, store errors
- `tests/gateway/api.test.ts` — `/api/secrets*` behavior and loopback enforcement

### HTTP API

All `/api/secrets*` routes are **loopback-only** for every method. Non-loopback →
`403 { "error": "This endpoint is only available from localhost" }`. **No route returns a stored
value.** Errors whose message starts with `Validation failed` are `400`; other thrown errors are
`500`.

Mutating routes and both status routes return the same **secret payload** object:

```json
{
  "backend": "file",
  "path": "/Users/me/.config/omni-mcp/secrets.json",
  "keychainService": "omni-mcp",
  "keychainSupported": true,
  "count": 1,
  "secrets": [
    {
      "name": "JIRA_TOKEN",
      "set": true,
      "usages": [{ "path": "servers.jira.env.JIRA_TOKEN", "server": "jira" }]
    }
  ]
}
```

`path` is present only for the file backend. `count` is the number of variables in the store, while
`secrets` also includes config-referenced names that are not set.

#### `GET /api/secrets`
- **Triggered**: Secrets page load
- **Success (200)**: the secret payload

#### `GET /api/secrets/status`
- **Triggered**: status checks
- **Success (200)**: the same secret payload

#### `PUT /api/secrets/:name`
- **Triggered**: Add / Replace
- **Body**: `{ "value": "…" }` — `value` must be a non-empty string
- **Success (200)**: `{ "ok": true, …secret payload }` (adapters re-resolved)
- **Error (400)**: `{ "error": "Validation failed: value must be a non-empty string" }`
- **Error (500)**: invalid name or store failure

#### `DELETE /api/secrets/:name`
- **Triggered**: Delete confirmation
- **Success (200)**: `{ "ok": true, "deleted": true, …secret payload }`
- **Error (404)**: `{ "error": "Secret \"JIRA_TOKEN\" was not found" }`
- **Error (409)**:
```json
{
  "error": "Secret \"JIRA_TOKEN\" is still referenced",
  "usages": [{ "path": "servers.jira.env.JIRA_TOKEN", "server": "jira" }]
}
```

#### `POST /api/secrets/sync`
- **Triggered**: Sync button
- **Behavior**: re-applies the raw config, re-resolving from environment and the active backend
- **Success (200)**: `{ "ok": true, …secret payload }`

#### `POST /api/secrets/import-keychain`
- **Triggered**: Import dialog
- **Body**:
```json
{ "service": "jira", "account": "API_TOKEN", "name": "JIRA_TOKEN" }
```
- **Success (200)**: `{ "ok": true, …secret payload }`
- **Error (400)**: `{ "error": "Validation failed: service, account, and name are required" }`
- **Error (404)**: `{ "error": "Keychain item jira/API_TOKEN was not found" }`
- **Error (500)**: non-macOS host, or an `account` that is not a valid variable name

#### `GET /api/secrets/backend?backend=file|keychain`
- **Triggered**: Backend migration preview
- **Success (200)**:
```json
{ "from": "file", "to": "keychain", "count": 3, "keychainSupported": true }
```
- **Error (400)**: `{ "error": "backend query must be \"file\" or \"keychain\"" }`

#### `POST /api/secrets/backend`
- **Triggered**: Confirmed backend migration
- **Body**: `{ "backend": "keychain" }`
- **Success (200)**: `{ "ok": true, "migrated": 3, …secret payload }`
- **Success (200)** when already active: `{ "ok": true, "migrated": 0, …secret payload }`
- **Error (400)**: `{ "error": "Validation failed: backend must be \"file\" or \"keychain\"" }`
- **Error (500)**: migration or config write failure (both stores rolled back)

#### `GET /api/secrets/migrate-inline`
- **Triggered**: Inline migration preview
- **Success (200)**:
```json
{
  "candidates": [
    { "name": "GITHUB_TOKEN", "server": "github", "field": "env", "envKey": "GITHUB_TOKEN" },
    { "name": "PRODUCTION_DB_TOKEN", "server": "production-db", "field": "auth" }
  ],
  "conflicts": []
}
```
Candidates never include values. Already-referenced and `********` fields are omitted.

#### `POST /api/secrets/migrate-inline`
- **Triggered**: Apply inline migration
- **Body**: `{ "renames": { "PRODUCTION_DB_TOKEN": "PROD_DB_JWT" } }` (`renames` optional)
- **Success (200)**: `{ "ok": true, "migrated": 2, …secret payload }`
- **Error (409)**: `{ "error": "Migration has variable-name collisions", "conflicts": ["GITHUB_TOKEN"] }`
- **Error (400)**: `{ "error": "Validation failed: rename values must be strings" }`

### Config

Example config plus store:

```json
{
  "secretStore": { "backend": "file", "keychainService": "omni-mcp" },
  "servers": {
    "jira": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@jira/mcp-server"],
      "env": { "JIRA_TOKEN": "$JIRA_TOKEN" }
    }
  }
}
```

`~/.config/omni-mcp/secrets.json`:

```json
{
  "JIRA_TOKEN": "hidden-from-git"
}
```

If the shell exports a non-empty `JIRA_TOKEN`, that value wins. Otherwise the file value is used.
If neither is set, config load fails with:

```
servers.jira.env.JIRA_TOKEN: neither the process environment nor the active secret store defines "JIRA_TOKEN"
```

### Libraries and Components to Reuse

| Name | Import Path | Purpose |
|---|---|---|
| `Card` | `@/components/ui/card` | Backend summary and per-variable cards |
| `Dialog` | `@/components/ui/dialog` | Add/replace and Keychain import |
| `Alert` | `@/components/ui/alert` | Error messages |
| `Badge` | `@/components/ui/badge` | Backend, set/unset |
| `Button` | `@/components/ui/button` | Actions |
| `Input` | `@/components/ui/input` | Names; `type="password"` for values |
| `Label` | `@/components/ui/label` | Dialog fields |

### Technical Constraints
- Default bind `127.0.0.1`; every `/api/secrets*` route is loopback-only
- No login page; no reveal-value control
- Secrets file path is fixed at `~/.config/omni-mcp/secrets.json`
- Keychain backend is macOS-only
- English copy only; no i18n keys
- Do not bump `package.json` version by hand (semantic-release)
- Never persist resolved secrets into the config file
