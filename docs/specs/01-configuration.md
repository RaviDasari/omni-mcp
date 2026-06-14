# omni-mcp — Configuration Spec

## Overview

All runtime behavior is driven by a single JSON configuration file: `omni-mcp.config.json`. The file defines the upstream MCP server fleet, named profiles, and token credentials. This document specifies the schema, validation rules, and environment variable resolution behavior.

---

## Config File Location

| Source | Behavior |
|--------|----------|
| `./omni-mcp.config.json` in CWD | Default, loaded automatically |
| `--config <path>` CLI flag | Overrides the default path |

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
  "tokens": { /* see Tokens section — see spec 02-token-auth.md */ }
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

      // Required. Executable name or path.
      "command": "npx",

      // Required. Arguments passed to the command.
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"],

      // Optional. Maximum automatic restart attempts on crash. Default: 3. Set to 0 to disable.
      "maxRestarts": 3,

      // Optional. Working directory for the spawned process. Default: CWD of omni-mcp.
      "cwd": "/home/user",

      // Optional. Additional environment variables for the child process.
      // Supports $VAR_NAME interpolation.
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

      // Required. Full base URL of the remote MCP server.
      "url": "https://internal.tools/mcp",

      // Optional. Authentication injected at the proxy layer.
      "auth": {
        // Currently supported: "jwt". "oauth" planned for Phase 2.
        "type": "jwt",

        // Required when type is "jwt".
        // Must be an environment variable reference ($VAR_NAME).
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

Any config string value starting with `$` (e.g., `"$MY_JWT_TOKEN"`) is resolved to `process.env[VAR_NAME]` at startup.

### Rules

1. Resolution is applied to: `servers.*.env.*`, `servers.*.auth.token`, and any `$`-prefixed string value in the config.
2. If the referenced environment variable is **not set or is empty**, startup fails with an error message identifying the missing variable and its config path.
3. Resolved secret values are **never logged**, written to disk, or included in `omni-mcp status` output.
4. Literal `$` characters that are not environment variable references must be escaped as `$$`.

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

At startup, `$MY_API_JWT` is replaced with `process.env.MY_API_JWT`. If `MY_API_JWT` is not set, the process exits with:

```
[omni-mcp] ERROR: Config validation failed.
  servers.my-api.auth.token references "$MY_API_JWT" but the environment variable MY_API_JWT is not set.
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
  3. servers.my-api.auth.token: "$MY_API_JWT" is not set in environment
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
