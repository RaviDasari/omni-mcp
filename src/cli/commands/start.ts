import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../../config/index.js";
import { startApp, stopApp, type AppContext } from "../../app.js";
import { setLogLevel, type LogLevel } from "../../logger.js";
import { writePidFile, removePidFile } from "../pid.js";
import { DEFAULT_CONFIG_PATH } from "../config-path.js";

const DAEMON_DIR = join(homedir(), ".omni-mcp");
const LOG_FILE = join(DAEMON_DIR, "omni-mcp.log");

export interface StartOptions {
  config: string;
  port?: string;
  host?: string;
  profile?: string;
  logLevel: string;
  foreground?: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  if (!options.foreground) {
    daemonize(options);
    return;
  }

  runForeground(options);
}

function daemonize(options: StartOptions): void {
  mkdirSync(DAEMON_DIR, { recursive: true });

  const script = process.argv[1]!;
  const args = ["start", "--foreground",
    "--config", options.config,
    "--log-level", options.logLevel,
  ];
  if (options.port)    args.push("--port",    options.port);
  if (options.host)    args.push("--host",    options.host);
  if (options.profile) args.push("--profile", options.profile);

  const logFd = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [script, ...args], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);

  if (child.pid === undefined) {
    process.stderr.write("[omni-mcp] Failed to spawn background process.\n");
    process.exit(1);
  }

  child.unref();
  writePidFile(child.pid);

  process.stdout.write(`[omni-mcp] Started (PID ${child.pid}). Logs: ${LOG_FILE}\n`);
}

async function runForeground(options: StartOptions): Promise<void> {
  setLogLevel(options.logLevel as LogLevel);

  const { config, errors, warnings } = loadConfig(options.config);

  if (errors.length > 0) {
    const isNotFound = errors.length === 1 && errors[0]!.message.startsWith("Config file not found:");
    if (isNotFound) {
      process.stderr.write(
        `[omni-mcp] No config found. Run \`omni-mcp init\` to get started.\n` +
        `  Config will be created at: ${DEFAULT_CONFIG_PATH}\n`,
      );
    } else {
      process.stderr.write(
        `[omni-mcp] ERROR: Config validation failed (${errors.length} error(s)):\n`,
      );
      errors.forEach((e, i) => {
        process.stderr.write(`  ${i + 1}. ${e.message}\n`);
      });
    }
    process.exit(1);
  }

  if (!config) {
    process.stderr.write("[omni-mcp] ERROR: Failed to load config\n");
    process.exit(1);
  }

  if (options.port)    config.port = parseInt(options.port, 10);
  if (options.host)    config.host = options.host;
  if (options.profile) config.defaultProfile = options.profile;

  for (const w of warnings) {
    process.stdout.write(`[omni-mcp] WARNING: ${w.message}\n`);
  }

  if (config.host !== "127.0.0.1" && config.host !== "localhost") {
    process.stdout.write(
      `[omni-mcp] WARNING: Binding to ${config.host} — gateway accessible from network\n`,
    );
  }

  let context: AppContext;
  try {
    context = await startApp(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    process.stderr.write(`[omni-mcp] FATAL: ${message}\n`);
    process.exit(1);
  }

  writePidFile();

  const shutdown = async (signal: string) => {
    process.stdout.write(`\n[omni-mcp] Received ${signal}. Shutting down...\n`);
    await stopApp(context);
    removePidFile();
    process.exit(signal === "SIGINT" ? 130 : 0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  process.on("SIGHUP", () => {
    process.stdout.write("[omni-mcp] Received SIGHUP. Reloading...\n");
    const reloaded = loadConfig(options.config);
    if (reloaded.config) {
      context.config = reloaded.config;
      context.gateway.updateConfig(reloaded.config);
      process.stdout.write("[omni-mcp] Reload complete.\n");
    } else {
      process.stderr.write("[omni-mcp] Reload failed. Keeping current config.\n");
    }
  });
}
