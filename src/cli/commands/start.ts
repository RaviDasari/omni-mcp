import { loadConfig } from "../../config/index.js";
import { startApp, stopApp, type AppContext } from "../../app.js";
import { setLogLevel, type LogLevel } from "../../logger.js";
import { writePidFile, removePidFile } from "../pid.js";

interface StartOptions {
  config: string;
  port?: string;
  host?: string;
  profile?: string;
  logLevel: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  setLogLevel(options.logLevel as LogLevel);

  const { config, errors, warnings } = loadConfig(options.config);

  if (errors.length > 0) {
    process.stderr.write(
      `[omni-mcp] ERROR: Config validation failed (${errors.length} error(s)):\n`,
    );
    errors.forEach((e, i) => {
      process.stderr.write(`  ${i + 1}. ${e.message}\n`);
    });
    process.exit(1);
  }

  if (!config) {
    process.stderr.write("[omni-mcp] ERROR: Failed to load config\n");
    process.exit(1);
  }

  // Apply CLI overrides
  if (options.port) config.port = parseInt(options.port, 10);
  if (options.host) config.host = options.host;
  if (options.profile) config.defaultProfile = options.profile;

  // Print warnings
  for (const w of warnings) {
    process.stdout.write(`[omni-mcp] WARNING: ${w.message}\n`);
  }

  // Warn if binding to non-loopback
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

  // Write PID file
  writePidFile();

  // Handle shutdown signals
  const shutdown = async (signal: string) => {
    process.stdout.write(`\n[omni-mcp] Received ${signal}. Shutting down...\n`);
    await stopApp(context);
    removePidFile();
    process.exit(signal === "SIGINT" ? 130 : 0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Handle SIGHUP for hot reload
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
