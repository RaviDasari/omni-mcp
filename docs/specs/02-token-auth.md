# omni-mcp — Token & Authentication Spec

## Overview

omni-mcp uses a token-based access control model. Each connecting client presents a token, which is resolved to a profile. The profile determines which upstream MCP servers and tools are visible to that client.

This enables:
- **Simple default usage**: a single `default` token controls all agents.
- **Named per-agent tokens**: e.g., separate tokens for Cursor, Claude Desktop, a CI bot.
- **Profile overrides**: different tokens can activate different profiles, providing fine-grained control without needing per-client configuration.

---

## Token Model

### Token Definition

Tokens are defined in the `tokens` block of `omni-mcp.config.json`:

```jsonc
{
  "tokens": {
    // Required. The fallback token used when the client presents an unknown token,
    // or when no token header is provided (if unrecognized token policy is "default").
    "default": {
      "profile": "safe-coding",
      "description": "General use — all agents"
    },

    // Named tokens bound to specific profiles.
    "cursor": {
      "profile": "admin",
      "description": "Cursor IDE — full access"
    },
    "claude": {
      "profile": "safe-coding",
      "description": "Claude Desktop — restricted tools"
    },
    "ci-bot": {
      "profile": "ci-workflow",
      "description": "Automated CI agent"
    }
  }
}
```

### Token Fields

| Field | Required | Description |
|-------|----------|-------------|
| `profile` | Yes | Name of the profile to activate when this token is presented. Must exist in the `profiles` block. |
| `description` | No | Human-readable label shown in `omni-mcp status` output. |
| `disabled` | No | If `true`, the token is rejected (treated as unauthorized). Default: `false`. |

---

## How Tokens Are Presented

Clients include their token in the MCP HTTP request using the standard `Authorization` header:

```
Authorization: ******
```

The token value is the **key name** from the `tokens` block (e.g., `cursor`, `claude`, `default`), not a secret.

> **Security note**: Token values are short-lived identifiers used for routing and profile selection. For Phase 1, they act as shared secrets for local developer machines. All communication is on localhost. Cryptographic signing is a Phase 2 consideration.

---

## Profile Resolution Order

When a request arrives, the active profile is resolved using this precedence (highest to lowest):

```
1. Named token with a profile binding   → token.profile
2. "default" token profile              → tokens.default.profile
3. Config-level defaultProfile          → config.defaultProfile
4. Built-in fallback                    → "default" profile
```

### Resolution Rules

1. **Known token**: Look up the token name in the `tokens` block, use its `profile` value.
2. **Unknown token + policy is `"fallback-to-default"`**: Use the `default` token's profile. Log a warning.
3. **Unknown token + policy is `"reject"`**: Return HTTP 401. Log the attempt.
4. **No token provided + policy is `"fallback-to-default"`**: Use the `default` token's profile.
5. **No token provided + policy is `"reject"`**: Return HTTP 401.

The unrecognized-token policy is configured via:

```jsonc
{
  "security": {
    // "fallback-to-default" (default for Phase 1) or "reject"
    "unknownTokenPolicy": "fallback-to-default"
  }
}
```

---

## Token → Profile → Server Mapping

```text
Client request
  │
  │  Authorization: ******
  ▼
Token lookup:  "cursor" → profile: "admin"
  │
  ▼
Profile lookup: "admin" → allow: ["*"]
  │
  ▼
Tool aggregation: all configured servers exposed
```

```text
Client request
  │
  │  Authorization: ******
  ▼
Token lookup: "claude" → profile: "safe-coding"
  │
  ▼
Profile lookup: "safe-coding" → allow: ["filesystem", "github"]
  │
  ▼
Tool aggregation: only "filesystem" and "github" tools exposed
```

---

## Token Lifecycle

### Disabling a Token

Set `"disabled": true` on the token entry. Requests using a disabled token receive HTTP 401 with a reason of `"token_disabled"`. The entry is preserved in config so the description is retained.

```jsonc
{
  "tokens": {
    "ci-bot": {
      "profile": "ci-workflow",
      "disabled": true,
      "description": "Suspended — see ticket #42"
    }
  }
}
```

### Revoking / Removing a Token

Remove the token entry from `omni-mcp.config.json` and restart (or hot-reload, if supported). The token becomes unknown and is handled by `unknownTokenPolicy`.

### Hot Reload (Phase 1 target)

The system SHOULD support live reload of the `tokens` block (and `profiles`) on `SIGHUP` or via `omni-mcp reload` CLI command, without restarting upstream server processes.

---

## Security Considerations

| Risk | Mitigation |
|------|------------|
| Token value exposed in logs | Token values MUST NOT appear in any log output |
| Config file contains token names | Config is local to developer machine; warn if file is world-readable |
| Token reuse across machines | Token names are logical keys, not cryptographic secrets — rotate by changing the key and restarting |
| Unauthorized local access | Phase 1 binds to `127.0.0.1` only by default; binding to `0.0.0.0` requires explicit `--host` flag |

---

## Examples

### Simple Setup — One Token for Everything

```json
{
  "tokens": {
    "default": { "profile": "default" }
  },
  "profiles": {
    "default": { "allow": ["*"] }
  }
}
```

Any client without a token (or with any unrecognized token) gets full access. Suitable for solo developers who want zero friction.

---

### Multi-Agent Setup — Token per Client

```json
{
  "tokens": {
    "default":  { "profile": "safe-coding", "description": "Fallback for unknown agents" },
    "cursor":   { "profile": "admin",        "description": "Cursor IDE" },
    "claude":   { "profile": "safe-coding",  "description": "Claude Desktop" },
    "ci-bot":   { "profile": "ci-workflow",  "description": "Automated CI" }
  },
  "profiles": {
    "default":     { "allow": ["filesystem"] },
    "safe-coding": { "allow": ["filesystem", "github"] },
    "admin":       { "allow": ["*"] },
    "ci-workflow": { "allow": ["github", "test-runner"] }
  },
  "security": {
    "unknownTokenPolicy": "fallback-to-default"
  }
}
```
