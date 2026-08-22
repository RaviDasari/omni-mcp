import type { HttpServerConfig, OmniMcpConfig, StdioServerConfig } from "./schema.js";

export const REDACTED_SECRET = "********";

function isRedacted(value: string | undefined): boolean {
  return value === undefined || value === "" || value === REDACTED_SECRET;
}

export function redactConfig(config: OmniMcpConfig): OmniMcpConfig {
  const clone = structuredClone(config);

  for (const server of Object.values(clone.servers)) {
    if (server.type === "stdio" && server.env) {
      for (const key of Object.keys(server.env)) {
        server.env[key] = REDACTED_SECRET;
      }
    }
    if (server.type === "http" && server.auth?.token) {
      server.auth.token = REDACTED_SECRET;
    }
  }

  return clone;
}

/**
 * Restore secret fields that the UI omitted or sent as the redaction placeholder.
 */
export function mergeSecrets(incoming: OmniMcpConfig, previous: OmniMcpConfig): OmniMcpConfig {
  const merged = structuredClone(incoming);

  for (const [name, server] of Object.entries(merged.servers)) {
    const prev = previous.servers[name];
    if (!prev || prev.type !== server.type) continue;

    if (server.type === "stdio" && prev.type === "stdio") {
      mergeStdioEnv(server, prev);
    }
    if (server.type === "http" && prev.type === "http") {
      mergeHttpAuth(server, prev);
    }
  }

  return merged;
}

function mergeStdioEnv(server: StdioServerConfig, previous: StdioServerConfig): void {
  if (!server.env) return;
  const prevEnv = previous.env ?? {};
  for (const [key, value] of Object.entries(server.env)) {
    if (isRedacted(value) && key in prevEnv) {
      server.env[key] = prevEnv[key]!;
    }
  }
}

function mergeHttpAuth(server: HttpServerConfig, previous: HttpServerConfig): void {
  if (!server.auth) return;
  if (isRedacted(server.auth.token) && previous.auth?.token) {
    server.auth.token = previous.auth.token;
  }
}
