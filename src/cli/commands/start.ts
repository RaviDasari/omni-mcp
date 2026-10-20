import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../../config/index.js";
import { startApp, stopApp, type AppContext } from "../../app.js";
import { setLogLevel, type LogLevel } from "../../logger.js";
import { writePidFile, removePidFile, writeRuntimeMetadata } from "../pid.js";
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
    await daemonize(options);
    return;
  }

  runForeground(options);
}

async function daemonize(options: StartOptions): Promise<void> {
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
  const logOffset = statSync(LOG_FILE).size;
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
  const loaded = loadConfig(options.config).config;
  const host = options.host ?? loaded?.host ?? "127.0.0.1";
  const port = options.port ? parseInt(options.port, 10) : (loaded?.port ?? 6317);
  writeRuntimeMetadata({
    pid: child.pid,
    configPath: resolve(options.config),
    host,
    port,
  });

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  const startedAt = Date.now();
  const health = await waitForGateway(`http://${host}:${port}`, () => exited, startedAt);

  if (!health) {
    removePidFile();
    process.stderr.write(
      `[omni-mcp] Failed to start (PID ${child.pid} ${exited ? "exited" : "did not become ready"}).\n`,
    );
    for (const line of recentLogProblems(logOffset)) process.stderr.write(`  ${line}\n`);
    process.stderr.write(`  Full log: ${LOG_FILE}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`[omni-mcp] Started (PID ${child.pid}). Logs: ${LOG_FILE}\n`);
  const url = `http://${host}:${port}`;
  const blocked = Object.entries(health.servers ?? {}).filter(([, server]) => server.status === "config-error");
  for (const issue of health.issues ?? []) process.stdout.write(`[omni-mcp] WARNING: ${issue}\n`);
  for (const [name, server] of blocked) {
    process.stdout.write(`[omni-mcp] WARNING: server "${name}" not started\n`);
    for (const issue of server.issues ?? []) process.stdout.write(`    - ${issue}\n`);
  }
  if (blocked.length > 0 || (health.issues?.length ?? 0) > 0) {
    process.stdout.write(`[omni-mcp] Fix in the UI: ${url}/variables (then the server starts automatically)\n`);
  }
}

interface StartupHealth {
  uptime: number;
  issues?: string[];
  servers?: Record<string, { status: string; issues?: string[] }>;
}

async function waitForGateway(
  url: string,
  hasExited: () => boolean,
  startedAt: number,
  timeoutMs = 15000,
): Promise<StartupHealth | undefined> {
  while (Date.now() - startedAt < timeoutMs) {
    if (hasExited()) return undefined;
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const health = (await response.json()) as StartupHealth;
        // Ignore an older gateway still answering on the same port.
        if (health.uptime <= (Date.now() - startedAt) / 1000 + 1) return health;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return undefined;
}

function recentLogProblems(offset: number): string[] {
  try {
    const lines = readFileSync(LOG_FILE).subarray(offset).toString("utf8").split("\n");
    const start = lines.findIndex((line) => /ERROR|FATAL|Config validation failed/.test(line));
    return (start === -1 ? lines.slice(-10) : lines.slice(start)).filter(Boolean).slice(0, 20);
  } catch {
    return [];
  }
}

async function runForeground(options: StartOptions): Promise<void> {
  setLogLevel(options.logLevel as LogLevel);

  const { config, rawConfig, errors, warnings, serverIssues, globalIssues } = loadConfig(options.config);

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
    context = await startApp(config, {
      configPath: options.config,
      rawConfig,
      serverIssues,
      globalIssues,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    process.stderr.write(`[omni-mcp] FATAL: ${message}\n`);
    process.exit(1);
  }

  writePidFile();
  writeRuntimeMetadata({
    pid: process.pid,
    configPath: resolve(options.config),
    host: config.host,
    port: config.port,
  });

  if (Object.keys(serverIssues).length > 0 || globalIssues.length > 0) {
    process.stdout.write(
      `[omni-mcp] Fix in the UI: http://${config.host}:${config.port}/variables (blocked servers start automatically once fixed)\n`,
    );
  }

  const shutdown = async (signal: string) => {
    process.stdout.write(`\n[omni-mcp] Received ${signal}. Shutting down...\n`);
    await stopApp(context);
    removePidFile();
    process.exit(signal === "SIGINT" ? 130 : 0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));

  process.on("SIGHUP", () => {
    void (async () => {
      process.stdout.write("[omni-mcp] Received SIGHUP. Reloading...\n");
      try {
        await context.gateway.reloadFromDisk();
        process.stdout.write("[omni-mcp] Reload complete.\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        process.stderr.write(`[omni-mcp] Reload failed: ${message}. Keeping current config.\n`);
      }
    })();
  });
}
