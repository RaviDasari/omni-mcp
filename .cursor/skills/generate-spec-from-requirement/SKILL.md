---
name: generate-spec-from-requirement
description: Generates a Markdown specification in docs/specs/ capturing functional requirements and technical specs for omni-mcp (gateway, CLI, web UI). Use when creating a spec for a new feature, translating tickets or user stories into an AI-readable reference, or consolidating requirements before implementation.
---

# Generate Spec from Requirement

Write a **Markdown specification** under `docs/specs/`. Specs are the source of truth for behavior; agents must read the relevant spec before changing code.

> This skill produces a **Markdown file**, not a test. Output is consumed by humans and AI, not executed.

## When to Use

- Before implementing a new feature — spec first
- When a ticket, user story, or design note needs an AI-readable reference
- When consolidating scattered requirements into one document

## Output Location

Architecture and feature specs live here:

```
docs/specs/
  NN-kebab-name.md
```

- Use a two-digit prefix. Next unused number after the current index (today: `00`–`08`, so the next new spec is `09-…`).
- Filename is kebab-case from the feature name: `09-config-hot-reload.md`.
- Do **not** write to a top-level `spec/` directory (that is DeepWiki’s layout, not this repo).
- If a spec for the same topic already exists, **read it first** and extend or update it. Do not duplicate.
- If the change is a small addition to an existing area, update that numbered spec instead of creating a new file.

After adding a **new** numbered file, also update:

- Spec Index in [`docs/specs/00-overview.md`](../../../docs/specs/00-overview.md)
- Spec list in [`README.md`](../../../README.md)

Living specs stay in `docs/specs/` after implementation (update them if behavior drifts). Do not move files to a `completed/` folder.

## Inputs Required

Gather what is available; mark the rest `_TBD_`.

### Functional Requirements

- User stories or acceptance criteria
- CLI flags, commands, and output (human vs JSON)
- UI states: default, loading, empty, error, success (web UI only)
- User interactions and copy (English only — no i18n)
- Conditional behavior: “when X then Y”
- Security: bind address, loopback-only mutating `/api`, tokens as secrets

### Technical Specs

- **HTTP `/api`**: method, path, when triggered, query, sample JSON
- **MCP `/mcp`**: only if the feature changes protocol behavior
- **Gateway**: files under `src/` (`gateway/`, `config/`, `auth/`, `transport/`)
- **CLI**: `src/cli/commands/<name>.ts`, flags, exit codes
- **Web UI**: `web/src/pages/`, `web/src/components/`, `web/src/hooks/`, `web/src/lib/api.ts`
- **Tests**: `tests/` (Vitest) and any UI tests
- **Constraints**: Node `>=22.12`, default bind `127.0.0.1:6317`, no login page

## Project Tech Stack (Reference)

| Layer | Location | Stack |
|---|---|---|
| Gateway | `src/` | TypeScript, Node, HTTP on port `6317` (`/mcp`, `/api`, `/` UI) |
| CLI | `src/cli/` | `omni-mcp` / `omni-mcp-manager` — `start`, `status`, `add`, `reload`, … |
| Config | `omni-mcp.config.json`, `src/config/` | JSON schema; env/JWT redaction in API responses |
| Web UI | `web/` | Vite, React 19, TypeScript strict, Tailwind 4, shadcn (new-york), react-router |
| Tests | `tests/` | Vitest |

Defaults: bind `127.0.0.1`. Mutating `/api` requires a loopback client. Binding `0.0.0.0` without auth is unsafe. No login, AuthContext, or OAuth in Phase 1. English UI copy only.

For shadcn primitives, follow the `shadcn-ui` skill. Do not hand-roll controls that exist in the registry.

## Spec File Structure

Use this template. **Drop sections that do not apply** (CLI-only specs omit UI tables; UI-only specs omit CLI flags).

```markdown
# omni-mcp — <Feature Name>

## Overview

One or two sentences: what this does and why.

## Functional Requirements

### Behavior
- <Requirement>

### CLI (omit if N/A)
| Command / flag | Effect |
|---|---|
| `omni-mcp <cmd> --flag` | <what happens> |

### UI States (omit if N/A)
| State | Description |
|---|---|
| Default | |
| Loading | |
| Empty | |
| Error | |

### User Interactions (omit if N/A)
| Interaction | Expected Result |
|---|---|
| Click <element> | |

### Edge Cases
- <Edge case>

## Technical Specs

### Source Files

**Gateway**
- `src/gateway/gateway.ts` — …

**CLI**
- `src/cli/commands/<name>.ts` — …

**Web UI**
- `web/src/pages/<Page>.tsx` — …
- `web/src/lib/api.ts` — client helpers

**Tests**
- `tests/<area>/<name>.test.ts` — …

### HTTP API (omit if N/A)

#### `GET /api/<path>`
- **Triggered**:
- **Client restriction**: none (read) / loopback-only (mutate)
- **Query**:
- **Success (200)**:
\`\`\`json
{}
\`\`\`
- **Error (4xx/5xx)**:
\`\`\`json
{ "error": "…" }
\`\`\`

### Config (omit if N/A)

Fields added to `omni-mcp.config.json`, defaults, and env override names.

### Libraries and Components to Reuse
| Name | Import Path | Purpose |
|---|---|---|
| `Button` | `@/components/ui/button` | |
| `Card` | `@/components/ui/card` | |

### Technical Constraints
- Default bind `127.0.0.1`; mutating `/api` is loopback-only
- No login page
- English copy only; no i18n keys
- Do not bump `package.json` version by hand (semantic-release)

## Open Questions

- [ ] <TBD>
```

## Steps

### Step 1 — Collect information

Read tickets, existing `docs/specs/*.md`, related source, and API shapes already in `src/gateway/` / `web/src/lib/api.ts`.

### Step 2 — Choose create vs update

- Same topic as an existing numbered spec → update that file.
- New area → next `NN-kebab-name.md`.

### Step 3 — Check for an existing spec

Search `docs/specs/` (and README index). Read before writing.

### Step 4 — Write the spec

- Fill known details; `_TBD_` for unknowns
- Include full JSON examples for `/api` and config
- Name concrete files, commands, and routes
- Stay unambiguous; avoid “should work properly”

### Step 5 — Review completeness

- [ ] Overview states purpose
- [ ] Behavior and edge cases listed
- [ ] Affected layers named (gateway / CLI / UI) with file paths
- [ ] `/api` methods include path, restriction, and sample payloads
- [ ] Security constraints (loopback, tokens, bind) noted when relevant
- [ ] Open questions capture unknowns
- [ ] New numbered specs are linked from `00-overview.md` and `README.md`

## Example

**Input:** Add a CLI `omni-mcp logs --follow` that tails gateway stderr.

**Generated file:** `docs/specs/09-cli-logs.md` (number is illustrative)

```markdown
# omni-mcp — CLI logs

## Overview

`omni-mcp logs` prints recent gateway log lines and optionally follows the log file so operators can debug without attaching to the daemon tty.

## Functional Requirements

### Behavior
- `omni-mcp logs` prints the last 100 lines of the gateway log and exits 0
- `--follow` continues streaming until SIGINT
- Missing log file → exit 1 with a message that `omni-mcp start` has not been run

### CLI
| Command / flag | Effect |
|---|---|
| `omni-mcp logs` | Print last 100 lines |
| `omni-mcp logs --follow` | Tail until interrupt |
| `omni-mcp logs --lines <n>` | Override line count |

### Edge Cases
- Daemon not running and no log file → exit 1
- `--lines` less than 1 → exit 2 (usage error)

## Technical Specs

### Source Files

**CLI**
- `src/cli/commands/logs.ts` — command
- `src/cli/index.ts` — register command

**Tests**
- `tests/cli/logs.test.ts`

### HTTP API
None.

### Technical Constraints
- Do not expose logs over `/api` in this spec (local files only)

## Open Questions
- [ ] Log file path: next to pid file vs XDG cache?
```
