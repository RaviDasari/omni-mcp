import type { HttpServerConfig, OmniMcpConfig, StdioServerConfig } from "./schema.js";

export const REDACTED_SECRET = "********";
const SECRET_REFERENCE = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/;

export interface SecretUsage {
  path: string;
  server?: string;
}

export function secretReferenceName(value: string): string | undefined {
  if (!SECRET_REFERENCE.test(value)) return undefined;
  return value.startsWith("${") ? value.slice(2, -1) : value.slice(1);
}

function isRedacted(value: string | undefined): boolean {
  return value === undefined || value === "" || value === REDACTED_SECRET;
}

export function redactConfig(config: OmniMcpConfig): OmniMcpConfig {
  const clone = structuredClone(config);

  for (const server of Object.values(clone.servers)) {
    if (server.type === "stdio" && server.env) {
      for (const key of Object.keys(server.env)) {
        if (!secretReferenceName(server.env[key]!)) {
          server.env[key] = REDACTED_SECRET;
        }
      }
    }
    if (server.type === "http" && server.auth?.token) {
      if (!secretReferenceName(server.auth.token)) {
        server.auth.token = REDACTED_SECRET;
      }
    }
  }

  return clone;
}

export function collectSecretUsages(config: OmniMcpConfig): Record<string, SecretUsage[]> {
  const usages: Record<string, SecretUsage[]> = {};
  const visit = (value: unknown, path: string, server?: string): void => {
    if (typeof value === "string") {
      const name = secretReferenceName(value);
      if (name) (usages[name] ??= []).push({ path, server });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`, server));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${key}` : key;
      const nextServer = path === "servers" ? key : server;
      visit(entry, nextPath, nextServer);
    }
  };
  visit(config, "");
  return usages;
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
