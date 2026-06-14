# 🌐 omni-mcp

**One proxy. All your MCP servers. Every IDE.**

Stop copying MCP configs across Cursor, VS Code, Claude Desktop, and Windsurf. omni-mcp gives you a single gateway that consolidates all your MCP servers, applies per-agent access control, and isolates crashes — so one broken server never takes down your entire AI workflow.

## ⚡ 30-Second Quick Start

```bash
# 1. Scaffold your config (auto-imports from your existing IDE MCP configs)
npx omni-mcp init --import

# 2. Start the gateway
npx omni-mcp start

# 3. Point your IDE to the gateway (get copy-paste snippets)
npx omni-mcp ide-snippets
```

That's it. All your AI clients now share a single, managed MCP endpoint at `http://127.0.0.1:6317/mcp`.

## 🤯 Why Developers Love This

| Before omni-mcp | After omni-mcp |
|-----------------|----------------|
| 5 servers × 3 IDEs = **15 config entries** to maintain | 1 config file + **3 one-line IDE entries** |
| One server crashes → IDE freezes | Crash isolated → other tools keep working |
| All agents see all tools (no control) | Per-agent profiles: Cursor gets admin, Claude gets safe mode |
| Adding a server = edit every IDE config | `omni-mcp add github --npx "@modelcontextprotocol/server-github"` → done everywhere |
| Secrets scattered across IDE configs | Secrets live in one place, injected at the proxy layer |

## ✨ Key Features

- **Unified Proxy Routing**: Consolidate 10+ individual MCP servers into a single endpoint. Stop managing complex, scattered configuration files across multiple IDEs.
- **Profile-Based Access Control**: Instantly create user, team, or project-specific profiles. Toggle risky tools on or off with simple, fine-grained controls before exposing them to an LLM.
- **Auto-Discovery & Import**: Detect existing MCP configs from Cursor, VS Code, and Claude Desktop. Import your server fleet in one command.
- **Transport Bridging**: Seamlessly map local transports (`stdio`) and remote streamable HTTP endpoints into a standardized, secure connection pane.
- **Crash & Concurrency Protection**: Isolate individual servers behind dedicated internal proxies. Prevent cascading failures and stop misbehaving tools from crashing your entire agent workspace.
- **Secured Workflows**: Inject secure authentication tokens (JWT or OAuth) directly at the proxy layer to safeguard against tool-based token theft and local environment exploits.
- **Hot Reload**: Change tokens, profiles, or add servers without restarting. Your IDE sessions stay connected.

## 🏗️ Architecture Overview

```text
 [Cursor / VS Code / Claude Desktop / Windsurf / Any MCP Client]
                │
                ▼ (Single HTTP Connection)
   ┌────────────────────────────────────────┐
   │            omni-mcp (port 6317)        │
   │                                        │
   │  Token: "cursor" → Profile: admin      │
   │  Token: "claude" → Profile: safe       │
   │  Token: "default" → Profile: safe      │
   ├────────────────────────────────────────┤
   │  Profile "admin": allow ["*"]          │
   │  Profile "safe":  allow [fs, github]   │
   └──────┬──────────────┬─────────────┬────┘
          │              │             │
    (Local stdio)  (Local stdio)  (Remote HTTP)
          ▼              ▼             ▼
   ┌───────────┐  ┌───────────┐  ┌───────────┐
   │filesystem │  │  github   │  │ prod-api  │
   └───────────┘  └───────────┘  └───────────┘
```

## 🚀 Getting Started

### Install

```bash
npm install -g omni-mcp
```

Or use without installing:

```bash
npx omni-mcp init
```

### Import Existing Config

Already using MCP servers in your IDE? Import them all:

```bash
npx omni-mcp init --import
```

This scans Cursor, VS Code, and Claude Desktop configs, imports all servers, and generates sensible token/profile defaults.

### Manual Config

Create `omni-mcp.config.json`:

```json
{
  "port": 6317,
  "servers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"]
    },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
    }
  },
  "profiles": {
    "default": { "allow": ["filesystem"] },
    "admin":   { "allow": ["*"] }
  },
  "tokens": {
    "default": { "profile": "default" },
    "cursor":  { "profile": "admin" }
  }
}
```

### Add Servers Without Editing JSON

```bash
omni-mcp add puppeteer --npx "@modelcontextprotocol/server-puppeteer" --profile admin
omni-mcp add memory --npx "@modelcontextprotocol/server-memory" --profile default --profile admin
```

### Start the Gateway

```bash
omni-mcp start
```

### Connect Your IDE

Run `omni-mcp ide-snippets` for exact copy-paste configs, or add this to your IDE's MCP config:

```json
{
  "url": "http://127.0.0.1:6317/mcp",
  "headers": { "Authorization": "******" }
}
```

## 🎯 Common Use Cases

### Solo Developer — Simplify MCP Management

One config to rule them all. Stop editing 3+ IDE configs every time you add a server.

### Safety-Conscious Developer — Restrict Dangerous Tools

Give Claude Desktop read-only tools while Cursor gets full access:

```json
{
  "tokens": {
    "cursor": { "profile": "full" },
    "claude": { "profile": "readonly" }
  }
}
```

### Team Lead — Shared MCP Standards

Commit `omni-mcp.config.json` to your repo. Everyone on the team gets the same MCP setup with one command.

### CI/CD — Automated Agents

Give your CI bot its own token with access only to deployment tools:

```json
{
  "tokens": {
    "ci-bot": { "profile": "deploy-only" }
  }
}
```

## 📊 CLI Commands

| Command | Description |
|---------|-------------|
| `omni-mcp init` | Interactive setup with auto-import from existing IDE configs |
| `omni-mcp start` | Start the proxy gateway |
| `omni-mcp stop` | Graceful shutdown |
| `omni-mcp status` | Show server health, active connections, profiles |
| `omni-mcp add <name>` | Add a server to config via CLI |
| `omni-mcp remove <name>` | Remove a server from config |
| `omni-mcp reload` | Hot-reload tokens and profiles without restart |
| `omni-mcp validate` | Check config validity (great for CI/pre-commit) |
| `omni-mcp ide-snippets` | Print IDE-specific setup snippets |

## 🎯 Target Scope & Roadmap

- **Phase 1 (Current Focus)**: Single client-side proxy manager optimizing developer workflows in Cursor, VS Code, Claude Desktop, and local environments.
- **Phase 2 (Team Expansion)**: Standalone team cloud service wrapping multiple shared MCPs with integrated load balancing, web UI, and OAuth.
- **Phase 3 (Enterprise Platform)**: Full multi-tenant SaaS platform featuring auto-scaling regional proxies, enterprise compliance toggles, and AI-driven automated tool discovery.

## 📖 Documentation

Full specs are available in [`docs/specs/`](./docs/specs/):

- [Project Overview](./docs/specs/00-overview.md)
- [Configuration](./docs/specs/01-configuration.md)
- [Token & Auth](./docs/specs/02-token-auth.md)
- [Proxy Gateway](./docs/specs/03-proxy-gateway.md)
- [Transport Bridging](./docs/specs/04-transport-bridging.md)
- [Resilience](./docs/specs/05-resilience.md)
- [CLI](./docs/specs/06-cli.md)
- [IDE Integration](./docs/specs/07-ide-integration.md)
