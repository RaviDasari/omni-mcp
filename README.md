# 🌐 omni-mcp

A centralized client-side control center and unified proxy manager built to orchestrate, secure, and scale your personal fleet of Model Context Protocol (MCP) servers under one roof.

For developers running multiple AI clients (Cursor, VS Code, or local agent apps), managing decentralized MCP configurations can quickly lead to security vulnerabilities, token theft, and local service crashes under high concurrency. omni-mcp solves these pain points by wrapping your entire local MCP ecosystem into a single, bulletproof proxy gateway.

## ✨ Key Features

- **Unified Proxy Routing**: Consolidate 10+ individual MCP servers into a single endpoint. Stop managing complex, scattered configuration files across multiple IDEs.
- **Profile-Based Access Control**: Instantly create user, team, or project-specific profiles. Toggle risky tools on or off with simple, fine-grained controls before exposing them to an LLM.
- **Transport Bridging**: Seamlessly map local transports (`stdio`) and remote streamable HTTP endpoints into a standardized, secure connection pane.
- **Crash & Concurrency Protection**: Isolate individual servers behind dedicated internal proxies. Prevent cascading failures and stop misbehaving tools from crashing your entire agent workspace.
- **Secured Workflows**: Inject secure authentication tokens (JWT or OAuth) directly at the proxy layer to safeguard against tool-based token theft and local environment exploits.

## 🏗️ Architecture Overview

```text
 [Cursor / VS Code / Local Apps]
                │
                ▼ (Single Secure Connection)
   ┌────────────────────────────────┐
   │          omni-mcp              │ ◄── [Management UI / Profile Toggles]
   ├────────────────────────────────┤
   │  [Profile A]     [Profile B]   │
   │  (Safe Tools)   (Dev Workflow) │
   └───────┬────────────────┬───────┘
           │                │
     (Local stdio)     (Remote HTTP + JWT/OAuth)
           ▼                ▼
   ┌───────────────┐ ┌───────────────┐
   │ Local MCP     │ │ Remote MCP    │
   │ Server Fleet  │ │ Server Fleet  │
   └───────────────┘ └───────────────┘
```

## 🚀 Quick Start (Draft)

### 1. Installation

```bash
git clone https://github.com/RaviDasari/omni-mcp.git
cd omni-mcp
# Add your ecosystem-specific build steps here (e.g., npm install / go build / pip install)
```

### 2. Configure Your Fleet

Define your local and remote MCP servers in a central configuration file (`omni-mcp.config.json`):

```json
{
  "servers": {
    "local-filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    },
    "production-db": {
      "type": "http",
      "url": "https://internal.tools",
      "auth": {
        "type": "jwt"
      }
    }
  },
  "profiles": {
    "safe-coding": { "allow": ["local-filesystem"] },
    "admin-workflow": { "allow": ["*"] }
  }
}
```

### 3. Start the Manager

```bash
omni-mcp start --profile safe-coding
```

Point your IDE or local AI app to the unified omni-mcp proxy address, and you are ready to go.

## 🎯 Target Scope & Future Roadmap

- **Phase 1 (Current Focus)**: Single client-side proxy manager optimizing developer workflows in Cursor, VS Code, and local desktop environments.
- **Phase 2 (Team Expansion)**: Standalone team cloud service wrapping multiple shared MCPs with integrated load balancing and scaling.
- **Phase 3 (Enterprise Platform)**: Full multi-tenant SaaS platform featuring auto-scaling regional proxies, enterprise compliance toggles, and AI-driven automated tool discovery.
