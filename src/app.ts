import type { OmniMcpConfig, ServerConfig } from "./config/index.js";
import { Gateway } from "./gateway/index.js";
import { StdioAdapter, HttpAdapter, type ServerAdapter } from "./transport/index.js";
import { Logger } from "./logger.js";
import { VERSION } from "./version.js";
import { resolveUiDir } from "./ui-dir.js";
import { loadConfig, resolveConfig, writeConfig } from "./config/index.js";

export interface AppContext {
  config: OmniMcpConfig;
  rawConfig: OmniMcpConfig;
  gateway: Gateway;
  adapters: Map<string, ServerAdapter>;
  configPath?: string;
}

export interface StartAppOptions {
  configPath?: string;
  uiDir?: string;
  rawConfig?: OmniMcpConfig;
}

/**
 * Creates and initializes all server adapters from config.
 */
export async function createAdapters(
  config: OmniMcpConfig,
): Promise<Map<string, ServerAdapter>> {
  const adapters = new Map<string, ServerAdapter>();

  for (const [name, serverConfig] of Object.entries(config.servers)) {
    if (serverConfig.enabled === false) continue;
    adapters.set(name, createAdapter(name, serverConfig));
  }

  return adapters;
}

/**
 * Initializes all adapters concurrently.
 * Returns the count of successfully connected adapters.
 */
export async function initializeAdapters(
  adapters: Map<string, ServerAdapter>,
): Promise<{ connected: number; failed: number }> {
  const logger = new Logger("omni-mcp");
  let connected = 0;
  let failed = 0;

  const results = await Promise.allSettled(
    Array.from(adapters.entries()).map(async ([name, adapter]) => {
      try {
        await adapter.connect();
        connected++;
        logger.info(`  ✓  ${name.padEnd(15)} (${getAdapterType(adapter)})  — connected`);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : "Unknown error";
        logger.warn(`  ✗  ${name.padEnd(15)} (${getAdapterType(adapter)})  — error: ${message}`);
      }
    }),
  );

  return { connected, failed };
}

/**
 * Starts the full application: adapters + gateway.
 */
export function createAdapter(name: string, serverConfig: ServerConfig): ServerAdapter {
  if (serverConfig.type === "stdio") {
    const envOverrides: Record<string, string> = {};
    if (serverConfig.env) {
      for (const [k, v] of Object.entries(serverConfig.env)) {
        envOverrides[k] = v;
      }
    }
    return new StdioAdapter(name, serverConfig, envOverrides);
  }

  return new HttpAdapter(name, serverConfig, serverConfig.auth?.token);
}

export async function applyAdapterChanges(
  adapters: Map<string, ServerAdapter>,
  previous: OmniMcpConfig,
  next: OmniMcpConfig,
): Promise<void> {
  const logger = new Logger("omni-mcp");
  const prevNames = new Set(Object.keys(previous.servers));
  const nextNames = new Set(Object.keys(next.servers));

  for (const name of prevNames) {
    if (!nextNames.has(name)) {
      const adapter = adapters.get(name);
      if (adapter) {
        await adapter.disconnect().catch(() => undefined);
        adapters.delete(name);
        logger.info(`Disconnected removed server ${name}`);
      }
    }
  }

  for (const name of nextNames) {
    const nextServer = next.servers[name]!;
    const prevServer = previous.servers[name];
    const changed =
      !prevServer ||
      JSON.stringify(comparableServer(prevServer)) !==
        JSON.stringify(comparableServer(nextServer));

    if (!changed) continue;

    const existing = adapters.get(name);
    if (existing) {
      await existing.disconnect().catch(() => undefined);
      adapters.delete(name);
    }

    if (nextServer.enabled === false) {
      logger.info(`Disabled server ${name}`);
      continue;
    }

    const adapter = createAdapter(name, nextServer);
    adapters.set(name, adapter);
    try {
      await adapter.connect();
      logger.info(`  ✓  ${name} — connected`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.warn(`  ✗  ${name} — error: ${message}`);
    }
  }
}

export async function startApp(
  config: OmniMcpConfig,
  options: StartAppOptions = {},
): Promise<AppContext> {
  const logger = new Logger("omni-mcp");
  logger.info(`v${VERSION} starting...`);
  logger.info(`Active default profile: ${config.defaultProfile}`);

  const tokenNames = Object.keys(config.tokens);
  logger.info(`Tokens registered: ${tokenNames.join(", ")} (${tokenNames.length} total)`);

  const adapters = await createAdapters(config);

  logger.info("Initializing servers...");
  const { connected, failed } = await initializeAdapters(adapters);

  if (connected === 0 && adapters.size > 0) {
    throw new Error("All servers failed to initialize");
  }

  if (failed > 0) {
    logger.warn(`${failed} server(s) failed to initialize. Partial functionality available.`);
  }

  const initialRawConfig = options.rawConfig ?? structuredClone(config);
  const context: AppContext = {
    config,
    rawConfig: initialRawConfig,
    gateway: null as unknown as Gateway,
    adapters,
    configPath: options.configPath,
  };

  const gateway = new Gateway({
    config,
    rawConfig: initialRawConfig,
    adapters,
    configPath: options.configPath,
    uiDir: options.uiDir ?? resolveUiDir(),
    version: VERSION,
    onSaveConfig: async (rawNext) => {
      const resolved = resolveConfig(rawNext as unknown as Record<string, unknown>);
      if (!resolved.config || !resolved.rawConfig) {
        throw new Error(
          `Validation failed: ${resolved.errors.map((error) => error.message).join("; ")}`,
        );
      }
      if (options.configPath) {
        writeConfig(options.configPath, resolved.rawConfig);
      }
      await applyAdapterChanges(adapters, context.config, resolved.config);
      context.config = resolved.config;
      context.rawConfig = resolved.rawConfig;
      gateway.updateConfig(resolved.config, resolved.rawConfig);
      return resolved.config;
    },
    onReloadFromDisk: async () => {
      if (!options.configPath) {
        throw new Error("No config path configured");
      }
      const reloaded = loadConfig(options.configPath);
      if (!reloaded.config || !reloaded.rawConfig) {
        throw new Error(reloaded.errors.map((e) => e.message).join("; ") || "Reload failed");
      }
      await applyAdapterChanges(adapters, context.config, reloaded.config);
      context.config = reloaded.config;
      context.rawConfig = reloaded.rawConfig;
      gateway.updateConfig(reloaded.config, reloaded.rawConfig);
      return { warnings: reloaded.warnings.map((w) => w.message) };
    },
  });

  context.gateway = gateway;
  await gateway.start();

  logger.info(
    `Ready. ${connected}/${adapters.size} servers connected.${failed > 0 ? ` ${failed} server(s) in error state.` : ""} UI: http://${config.host}:${config.port}/`,
  );

  return context;
}

/**
 * Gracefully stops the application.
 */
export async function stopApp(context: AppContext): Promise<void> {
  const logger = new Logger("omni-mcp");
  logger.info("Shutting down...");

  await context.gateway.stop();

  // Disconnect all adapters
  await Promise.allSettled(
    Array.from(context.adapters.values()).map((a) => a.disconnect()),
  );

  logger.info("Stopped.");
}

function getAdapterType(adapter: ServerAdapter): string {
  if (adapter instanceof StdioAdapter) return "stdio";
  if (adapter instanceof HttpAdapter) return "http";
  return "unknown";
}

function comparableServer(server: ServerConfig): Record<string, unknown> {
  const { enabled, cli: _cli, ...rest } = server;
  return { enabled: enabled !== false, ...rest };
}
