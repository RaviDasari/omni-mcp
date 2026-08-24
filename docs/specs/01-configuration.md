# omni-mcp — Configuration Spec

## Overview

All runtime behavior is driven by a single JSON configuration file: `omni-mcp.config.json`. The file defines the upstream MCP server fleet, named profiles, and token credentials. This document specifies the schema, validation rules, and variable-reference resolution. Secret **values** live in a separate store; see [11-managed-secrets.md](./11-managed-secrets.md).

---

## Config File Location

| Source | Behavior |
|--------|----------|
| `~/.config/omni-mcp/config.json` | Default for CLI commands and `init` output |
| `--config <path>` CLI flag | Selects another config for commands that consume config |
| `init --output <path>` | Selects the generated config destination |

Relative paths supplied by the user are resolved against the current working directory. Runtime
health reports the normalized absolute `configPath`; hybrid CLI management uses the live API only
when that path exactly matches the normalized absolute selected path. The secrets file is a separate fixed path,
`~/.config/omni-mcp/secrets.json`, and does not move with `--config`.

---

## Top-Level Schema

```jsonc
{
  // Optional. Default: 6317
  "port": 6317,

  // Optional. Default: "default"
  "defaultProfile": "safe-coding",

  // Required. At least one server must be defined.
  "servers": { /* see Servers section */ },

  // Required. At least a "default" profile must be defined.
  "profiles": { /* see Profiles section */ },

  // Required. At least a "default" token must be defined.
  "tokens": { /* see Tokens section — see spec 02-token-auth.md */ },

  // Optional compatibility policy. Default: "fallback-to-default".
  "security": { "unknownTokenPolicy": "fallback-to-default" },

  // Optional. Default: file backend at ~/.config/omni-mcp/secrets.json (path is not configurable).
  // See spec 11-managed-secrets.md
  "secretStore": { "backend": "file", "keychainService": "omni-mcp" }
}
```

---

## `servers` Block

Each key is a unique server name used throughout the config (e.g., in profiles and log output).

### `type: "stdio"` — Local Process

```jsonc
{
  "servers": {
    "filesystem": {
      "type": "stdio",

      // Optional. Globally expose/start this server. Default: true.
      "enabled": true,

      // Optional. Expose this server through `omni-mcp cli`. Default: false.
      "cli": { "enabled": false },

      // Required. Executable name or path.
      "command": "npx",

      // Required. Arguments passed to the command.
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"],

      // Optional. Maximum automatic restart attempts on crash. Default: 3. Set to 0 to disable.
      "maxRestarts": 3,

      // Optional. Working directory for the spawned process. Default: CWD of omni-mcp.
      "cwd": "/home/user",

      // Optional. Additional environment variables for the child process.
      // Exact $NAME or ${NAME} references (see Environment Variable Resolution).
      "env": {
        "MY_API_KEY": "$MY_API_KEY"
      }
    }
  }
}
```

### `type: "http"` — Remote HTTP MCP Server

```jsonc
{
  "servers": {
    "production-db": {
      "type": "http",

      // Optional. Globally expose/connect to this server. Default: true.
      "enabled": true,

      // Optional. Expose this server through `omni-mcp cli`. Default: false.
      "cli": { "enabled": false },

      // Required. Full base URL of the remote MCP server.
      "url": "https://internal.tools/mcp",

      // Optional. Authentication injected at the proxy layer.
      "auth": {
        // Currently supported: "jwt". "oauth" planned for Phase 2.
        "type": "jwt",

        // Required when type is "jwt".
        // Prefer an exact $NAME or ${NAME} reference. Literals are accepted so they can
        // be migrated into the secret store (see spec 11-managed-secrets.md).
        "token": "$PROD_DB_JWT"
      },

      // Optional. Request timeout in milliseconds. Default: 30000.
      "timeoutMs": 30000
    }
  }
}
```

---

## `profiles` Block

Profiles define which servers a client can access. See [02-token-auth.md](./02-token-auth.md) for how tokens select profiles.

```jsonc
{
  "profiles": {
    // The "default" profile is required and used as the global fallback.
    "default": {
      // Allow all servers. Use ["*"] as wildcard, or list server names explicitly.
      "allow": ["*"]
    },

    "safe-coding": {
      // Only expose these servers to clients using this profile.
      "allow": ["filesystem", "github"]
    },

    "admin": {
      "allow": ["*"]
    }
  }
}
```

### Profile Rules

- `"allow": ["*"]` exposes all configured servers.
- `"allow": ["server-a", "server-b"]` exposes only the listed servers.
- A server name that does not exist in the `servers` block is a validation error.
- The profile named `"default"` is required and used when no other profile resolves.

---

## Environment Variable Resolution

Any config string value that is **exactly** `$NAME` or `${NAME}` is a reference. Lookup is
`process.env[NAME]` when non-empty, then the active secret store (`secretStore.backend`, default
file `~/.config/omni-mcp/secrets.json`). Full store, syntax, CLI, API, and UI contracts:
[11-managed-secrets.md](./11-managed-secrets.md).

### Rules

1. Resolution walks every JSON **string** in the config (including `servers.*.env.*` and
   `servers.*.auth.token`). A string is a reference only when it is exactly `$NAME` or `${NAME}`
   with `NAME` matching `^[A-Za-z_][A-Za-z0-9_]*$`. Embedded forms such as `Bearer-$TOKEN` are
   left unchanged.
2. If the name is unset or empty in **both** `process.env` and the active store, config load fails
   with an error identifying the missing variable and its config path.
3. The on-disk config keeps the raw `$NAME` / `${NAME}` strings. Resolved values are **never
   logged**, written back to the config file, or included in `omni-mcp status` / `/api` output.
4. A string that starts with `$$` is not a reference: the leading `$$` becomes a single `$` and
   the rest is kept as-is.

### Example

```json
{
  "servers": {
    "my-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "auth": {
        "type": "jwt",
        "token": "$MY_API_JWT"
      }
    }
  }
}
```

At startup, `$MY_API_JWT` is replaced from `process.env.MY_API_JWT` if that value is non-empty,
otherwise from the active secret store. If both are missing or empty, the process exits with:

```
[omni-mcp] ERROR: Config validation failed (1 error(s)):
  1. servers.my-api.auth.token: neither the process environment nor the active secret store defines "MY_API_JWT"
```

---

## Config Validation

The config file is validated against a JSON Schema at startup, before any servers are spawned.

### Validation Errors

All validation errors are reported together (not fail-fast) and printed to stderr. The process exits with code `1`.

Error format:

```
[omni-mcp] ERROR: Config validation failed (3 error(s)):
  1. servers.filesystem.command: required field missing
  2. profiles.bad-profile.allow: unknown server "nonexistent-server"
  3. servers.my-api.auth.token: neither the process environment nor the active secret store defines "MY_API_JWT"
```

### Warnings (non-fatal)

The following produce warnings but do not block startup:

- A profile exists but no token maps to it (profile is unreachable but valid).
- A server is defined but not included in any profile (server will never be used).

---

## Full Example

```json
{
  "port": 6317,
  "defaultProfile": "safe-coding",
  "servers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"],
      "maxRestarts": 3
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "$GITHUB_TOKEN"
      }
    },
    "production-db": {
      "type": "http",
      "url": "https://internal.tools/mcp",
      "auth": {
        "type": "jwt",
        "token": "$PROD_DB_JWT"
      }
    }
  },
  "profiles": {
    "default": { "allow": ["filesystem"] },
    "safe-coding": { "allow": ["filesystem", "github"] },
    "admin": { "allow": ["*"] }
  },
  "tokens": {
    "default": { "profile": "safe-coding" },
    "cursor":  { "profile": "admin" },
    "claude":  { "profile": "safe-coding" }
  }
}
```
