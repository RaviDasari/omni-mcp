---
name: omni-mcp-cli
description: Discovers and invokes CLI-enabled MCP tools through omni-mcp with compact, machine-readable output. Use when a task can be completed by a managed MCP server or when the user mentions omni-mcp, its CLI, or an available managed integration.
---

# omni-mcp CLI

Use `omni-mcp cli` to discover and invoke tools from MCP servers that the user has explicitly
enabled for CLI access. The local omni-mcp gateway must be running.

## Workflow

1. Confirm the CLI and gateway are available:

   ```bash
   command -v omni-mcp
   omni-mcp cli --list --json
   ```

   If the binary is missing, tell the user to install `omni-mcp-manager` globally. If the gateway
   is unavailable or no relevant server is enabled, explain what is missing; do not change server
   enablement without permission.

2. Discover narrowly to minimize context:

   ```bash
   omni-mcp cli <server> --search "<keyword>" --compact
   omni-mcp cli <server> --list --top 20 --sort usage --compact
   ```

   Use `--list --json` only when descriptions or parameter metadata are needed.

3. Inspect the selected tool before its first use:

   ```bash
   omni-mcp cli <server> <tool> --help
   ```

   Tool commands and flags are generated at runtime. Never assume a schema from memory.

4. Invoke with machine-readable output:

   ```bash
   omni-mcp cli <server> <tool> --required-flag value --json
   ```

   For nested or ambiguous arguments, use one of:

   ```bash
   omni-mcp cli <server> <tool> --args-json '{"key":"value"}' --json
   printf '%s' '{"key":"value"}' | omni-mcp cli <server> <tool> --stdin --json
   ```

5. Treat a nonzero exit code or an MCP result with `"isError": true` as failure. Report the
   actionable error without retrying destructive operations blindly.

## Output and safety

- Prefer `--json` for calls and parse stdout as one JSON value. Diagnostics go to stderr.
- Use `--head <n>` only when truncating an array will not hide information needed for correctness.
- `--compact`, `--search`, and `--top` are discovery optimizations, not invocation flags.
- CLI access bypasses omni-mcp profiles but remains local and opt-in per server.
- Follow normal confirmation rules for destructive, externally visible, or irreversible tools.
- Do not expose secrets in command arguments when an MCP tool provides a safer reference mechanism.
