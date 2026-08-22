#!/usr/bin/env node

import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { validateCommand } from "./commands/validate.js";
import { reloadCommand } from "./commands/reload.js";
import { restartCommand } from "./commands/restart.js";
import { addCommand } from "./commands/add.js";
import { removeCommand } from "./commands/remove.js";
import { ideSnippetsCommand } from "./commands/ide-snippets.js";
import { initCommand } from "./commands/init.js";
import { DEFAULT_CONFIG_PATH } from "./config-path.js";
import { runManagedCli } from "./managed-cli.js";
import { registerSecretsCommand } from "./commands/secrets.js";

const program = new Command();

program
  .name("omni-mcp")
  .description("One proxy. All your MCP servers. Every IDE.")
  .version("0.1.0");

program
  .command("start")
  .description("Start the proxy gateway (runs in background by default)")
  .option("--config <path>", "Path to config file", DEFAULT_CONFIG_PATH)
  .option("--port <number>", "Override the listen port")
  .option("--host <address>", "Override the bind address")
  .option("--profile <name>", "Override default profile")
  .option("--log-level <level>", "Log verbosity: error, warn, info, debug", "info")
  .option("--foreground", "Run in foreground instead of daemonizing")
  .action(startCommand);

program
  .command("stop")
  .description("Graceful shutdown of running instance")
  .option("--config <path>", "Path to config file", DEFAULT_CONFIG_PATH)
  .action(stopCommand);

program
  .command("status")
  .description("Show current state of running instance")
  .option("--config <path>", "Path to config file", DEFAULT_CONFIG_PATH)
  .option("--json", "Output machine-readable JSON")
  .action(statusCommand);

program
  .command("validate")
  .description("Validate config without starting")
  .option("--config <path>", "Path to config file", DEFAULT_CONFIG_PATH)
  .action(validateCommand);

program
  .command("reload")
  .description("Hot-reload configuration")
  .option("--config <path>", "Path to config file", DEFAULT_CONFIG_PATH)
  .action(reloadCommand);

program
  .command("restart")
  .description("Stop the running instance and start it again in the background")
  .option("--config <path>", "Path to config file", DEFAULT_CONFIG_PATH)
  .option("--port <number>", "Override the listen port")
  .option("--host <address>", "Override the bind address")
  .option("--profile <name>", "Override default profile")
  .option("--log-level <level>", "Log verbosity: error, warn, info, debug", "info")
  .action(restartCommand);

program
  .command("add <server-name>")
  .description("Add a server to config")
  .option("--type <type>", "Server type: stdio or http", "stdio")
  .option("--command <cmd>", "Command to spawn (stdio)")
  .option("--args <args...>", "Arguments for command (stdio)")
  .option("--npx <package>", "Shorthand: npx package (expands to --command npx --args)")
  .option("--url <url>", "Remote MCP server URL (http)")
  .option("--profile <name...>", "Add to profile allow list")
  .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
  .action(addCommand);

program
  .command("remove <server-name>")
  .description("Remove a server from config")
  .option("--config <path>", "Config file path", DEFAULT_CONFIG_PATH)
  .action(removeCommand);

program
  .command("ide-snippets")
  .description("Print IDE configuration snippets")
  .option("--token <name>", "Token name to use in snippets", "default")
  .option("--port <number>", "Port to use in snippets")
  .action(ideSnippetsCommand);

program
  .command("init")
  .description("Interactive setup with auto-import")
  .option("--import", "Auto-detect and import from existing IDE configs")
  .option("-y, --yes", "Accept all defaults non-interactively")
  .option("--output <path>", "Output path for config", DEFAULT_CONFIG_PATH)
  .option("--template <name>", "Start from template: minimal, multi-agent, team")
  .action(initCommand);

registerSecretsCommand(program);

program
  .command("cli")
  .description("Discover and call tools from CLI-enabled managed MCP servers");

if (process.argv[2] === "cli") {
  process.exitCode = await runManagedCli(process.argv.slice(3));
} else {
  await program.parseAsync();
}
