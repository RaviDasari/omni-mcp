#!/usr/bin/env node

import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { validateCommand } from "./commands/validate.js";
import { reloadCommand } from "./commands/reload.js";
import { addCommand } from "./commands/add.js";
import { removeCommand } from "./commands/remove.js";
import { ideSnippetsCommand } from "./commands/ide-snippets.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("omni-mcp")
  .description("One proxy. All your MCP servers. Every IDE.")
  .version("0.1.0");

program
  .command("start")
  .description("Start the proxy gateway")
  .option("--config <path>", "Path to config file", "./omni-mcp.config.json")
  .option("--port <number>", "Override the listen port")
  .option("--host <address>", "Override the bind address")
  .option("--profile <name>", "Override default profile")
  .option("--log-level <level>", "Log verbosity: error, warn, info, debug", "info")
  .action(startCommand);

program
  .command("stop")
  .description("Graceful shutdown of running instance")
  .option("--config <path>", "Path to config file", "./omni-mcp.config.json")
  .action(stopCommand);

program
  .command("status")
  .description("Show current state of running instance")
  .option("--config <path>", "Path to config file", "./omni-mcp.config.json")
  .option("--json", "Output machine-readable JSON")
  .action(statusCommand);

program
  .command("validate")
  .description("Validate config without starting")
  .option("--config <path>", "Path to config file", "./omni-mcp.config.json")
  .action(validateCommand);

program
  .command("reload")
  .description("Hot-reload configuration")
  .option("--config <path>", "Path to config file", "./omni-mcp.config.json")
  .action(reloadCommand);

program
  .command("add <server-name>")
  .description("Add a server to config")
  .option("--type <type>", "Server type: stdio or http", "stdio")
  .option("--command <cmd>", "Command to spawn (stdio)")
  .option("--args <args...>", "Arguments for command (stdio)")
  .option("--npx <package>", "Shorthand: npx package (expands to --command npx --args)")
  .option("--url <url>", "Remote MCP server URL (http)")
  .option("--profile <name...>", "Add to profile allow list")
  .option("--config <path>", "Config file path", "./omni-mcp.config.json")
  .action(addCommand);

program
  .command("remove <server-name>")
  .description("Remove a server from config")
  .option("--config <path>", "Config file path", "./omni-mcp.config.json")
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
  .option("--output <path>", "Output path for config", "./omni-mcp.config.json")
  .option("--template <name>", "Start from template: minimal, multi-agent, team")
  .action(initCommand);

program.parse();
