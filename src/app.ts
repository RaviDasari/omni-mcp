import type { OmniMcpConfig, StdioServerConfig, HttpServerConfig } from "./config/index.js";
import { Gateway } from "./gateway/index.js";
import { StdioAdapter, HttpAdapter, type ServerAdapter } from "./transport/index.js";
import { Logger } from "./logger.js";

export interface AppContext {
  config: OmniMcpConfig;
  gateway: Gateway;
  adapters: Map<string, ServerAdapter>;
}

/**
 * Creates and initializes all server adapters from config.
 */
export async function createAdapters(
  config: OmniMcpConfig,
): Promise<Map<string, ServerAdapter>> {
  const adapters = new Map<string, ServerAdapter>();
  const logger = new Logger("omni-mcp");

  for (const [name, serverConfig] of Object.entries(config.servers)) {
    let adapter: ServerAdapter;

    if (serverConfig.type === "stdio") {
      const envOverrides: Record<string, string> = {};
      if (serverConfig.env) {
        for (const [k, v] of Object.entries(serverConfig.env)) {
          envOverrides[k] = v;
        }
      }
      adapter = new StdioAdapter(name, serverConfig, envOverrides);
    } else {
      const authToken = serverConfig.auth?.token;
      adapter = new HttpAdapter(name, serverConfig, authToken);
    }

    adapters.set(name, adapter);
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
export async function startApp(config: OmniMcpConfig): Promise<AppContext> {
  const logger = new Logger("omni-mcp");
  logger.info(`v0.1.0 starting...`);
  logger.info(`Active default profile: ${config.defaultProfile}`);

  const tokenNames = Object.keys(config.tokens);
  logger.info(`Tokens registered: ${tokenNames.join(", ")} (${tokenNames.length} total)`);

  // Create and initialize adapters
  const adapters = await createAdapters(config);

  logger.info("Initializing servers...");
  const { connected, failed } = await initializeAdapters(adapters);

  if (connected === 0 && adapters.size > 0) {
    throw new Error("All servers failed to initialize");
  }

  if (failed > 0) {
    logger.warn(`${failed} server(s) failed to initialize. Partial functionality available.`);
  }

  // Start gateway
  const gateway = new Gateway({ config, adapters });
  await gateway.start();

  logger.info(
    `Ready. ${connected}/${adapters.size} servers connected.${failed > 0 ? ` ${failed} server(s) in error state.` : ""}`,
  );

  return { config, gateway, adapters };
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
