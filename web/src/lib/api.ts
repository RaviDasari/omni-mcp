import type {
  CliServerSummary,
  HealthPayload,
  IdeSnippetsResult,
  OmniMcpConfig,
  ProfileConfig,
  ServerConfig,
  ServerToolCallResponse,
  ServerToolsResponse,
  VariablesResponse,
  TokenConfig,
  TrafficLogGroupBy,
  TrafficLogListResponse,
  TrafficLogSummaryResponse,
} from "./types";

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  // A successful change may start or unblock servers; let health views refresh now.
  if (init?.method && init.method !== "GET") {
    window.dispatchEvent(new Event("omni:config-changed"));
  }
  return (await res.json()) as T;
}

export function fetchHealth(): Promise<HealthPayload> {
  return request("/api/health");
}

export function fetchConfig(): Promise<{ config: OmniMcpConfig }> {
  return request("/api/config");
}

export function putConfig(config: OmniMcpConfig): Promise<{ config: OmniMcpConfig }> {
  return request("/api/config", { method: "PUT", body: JSON.stringify({ config }) });
}

export function putServer(name: string, server: ServerConfig): Promise<{ config: OmniMcpConfig }> {
  return request(`/api/servers/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(server),
  });
}

export function setServerEnabled(
  name: string,
  enabled: boolean,
): Promise<{ config: OmniMcpConfig; health: HealthPayload }> {
  return request(`/api/servers/${encodeURIComponent(name)}/enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export function setServerCliEnabled(
  name: string,
  enabled: boolean,
): Promise<{ config: OmniMcpConfig; health: HealthPayload }> {
  return request(`/api/servers/${encodeURIComponent(name)}/cli-enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export function setServerToonEnabled(
  name: string,
  enabled: boolean,
): Promise<{ config: OmniMcpConfig; health: HealthPayload }> {
  return request(`/api/servers/${encodeURIComponent(name)}/toon-enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export function fetchCliServers(): Promise<{ servers: CliServerSummary[] }> {
  return request("/api/cli/servers");
}

export function deleteServer(name: string): Promise<{ config: OmniMcpConfig }> {
  return request(`/api/servers/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function fetchServerTools(name: string): Promise<ServerToolsResponse> {
  return request(`/api/servers/${encodeURIComponent(name)}/tools`);
}

export function setServerToolEnabled(
  server: string,
  tool: string,
  enabled: boolean,
): Promise<{ config: OmniMcpConfig }> {
  return request(
    `/api/servers/${encodeURIComponent(server)}/tools/${encodeURIComponent(tool)}/enabled`,
    { method: "PUT", body: JSON.stringify({ enabled }) },
  );
}

export function callServerTool(
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ServerToolCallResponse> {
  return request(`/api/servers/${encodeURIComponent(server)}/tools/call`, {
    method: "POST",
    body: JSON.stringify({ tool, arguments: args }),
  });
}

export function putProfile(name: string, profile: ProfileConfig): Promise<{ config: OmniMcpConfig }> {
  return request(`/api/profiles/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export function deleteProfile(name: string): Promise<{ config: OmniMcpConfig }> {
  return request(`/api/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function setProfileToolEnabled(
  profile: string,
  server: string,
  tool: string,
  enabled: boolean,
): Promise<{ config: OmniMcpConfig }> {
  return request(
    `/api/profiles/${encodeURIComponent(profile)}/servers/${encodeURIComponent(server)}/tools/${encodeURIComponent(tool)}/enabled`,
    { method: "PUT", body: JSON.stringify({ enabled }) },
  );
}

export function applyProfileTools(
  source: string,
  server: string,
  targets: string[],
): Promise<{ config: OmniMcpConfig; applied: string[]; skipped: string[] }> {
  return request(`/api/profiles/${encodeURIComponent(source)}/apply-deny-tools`, {
    method: "POST",
    body: JSON.stringify({ server, targets }),
  });
}

export function putToken(name: string, token: TokenConfig): Promise<{ config: OmniMcpConfig }> {
  return request(`/api/tokens/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(token),
  });
}

export function deleteToken(name: string): Promise<{ config: OmniMcpConfig }> {
  return request(`/api/tokens/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function postReload(): Promise<{ config: OmniMcpConfig; warnings: string[] }> {
  return request("/api/reload", { method: "POST" });
}

export function fetchVariables(): Promise<VariablesResponse> {
  return request("/api/variables");
}

export function putVariable(
  name: string,
  value: string,
  type: "secret" | "plain",
): Promise<VariablesResponse & { ok: true }> {
  return request(`/api/variables/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ value, type }),
  });
}

export function convertVariable(
  name: string,
  type: "secret" | "plain",
): Promise<VariablesResponse & { ok: true }> {
  return request(`/api/variables/${encodeURIComponent(name)}/type`, {
    method: "PUT",
    body: JSON.stringify({ type }),
  });
}

export function deleteVariable(name: string): Promise<VariablesResponse & { ok: true; deleted: true }> {
  return request(`/api/variables/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export function syncVariables(): Promise<VariablesResponse & { ok: true }> {
  return request("/api/variables/sync", { method: "POST" });
}

export function migrateSecretBackend(
  backend: "file" | "keychain",
): Promise<VariablesResponse & { ok: true; migrated: number }> {
  return request("/api/variables/secret-backend", {
    method: "POST",
    body: JSON.stringify({ backend }),
  });
}

export function previewSecretBackendMigration(
  backend: "file" | "keychain",
): Promise<{ from: "file" | "keychain"; to: "file" | "keychain"; count: number; keychainSupported: boolean }> {
  return request(`/api/variables/secret-backend?backend=${backend}`);
}

export function importKeychainSecret(
  name: string,
  service: string,
  account: string,
): Promise<VariablesResponse & { ok: true }> {
  return request("/api/variables/import-keychain", {
    method: "POST",
    body: JSON.stringify({ name, service, account }),
  });
}

export interface InlineSecretCandidate {
  name: string;
  server: string;
  field: "env" | "auth";
  envKey?: string;
}

export function fetchInlineSecretMigration(): Promise<{ candidates: InlineSecretCandidate[]; conflicts: string[] }> {
  return request("/api/variables/migrate-inline");
}

export function applyInlineSecretMigration(
  renames: Record<string, string> = {},
): Promise<VariablesResponse & { ok: true; migrated: number }> {
  return request("/api/variables/migrate-inline", {
    method: "POST",
    body: JSON.stringify({ renames }),
  });
}

export function fetchIdeSnippets(token?: string): Promise<IdeSnippetsResult> {
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return request(`/api/ide-snippets${q}`);
}

export interface TrafficLogFilters {
  from: string;
  to: string;
  source?: "mcp" | "cli";
  token?: string;
  profile?: string;
  server?: string;
  tool?: string;
}

function trafficQuery(filters: TrafficLogFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value) params.set(name, value);
  }
  return params;
}

export function fetchTrafficLogs(
  filters: TrafficLogFilters,
  offset = 0,
  limit = 100,
): Promise<TrafficLogListResponse> {
  const params = trafficQuery(filters);
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  return request(`/api/traffic-logs?${params}`);
}

export function fetchTrafficSummary(
  filters: TrafficLogFilters,
  groupBy: TrafficLogGroupBy,
): Promise<TrafficLogSummaryResponse> {
  const params = trafficQuery(filters);
  params.set("groupBy", groupBy);
  return request(`/api/traffic-logs/summary?${params}`);
}

export function clearTrafficLogs(): Promise<{ ok: true; deleted: true }> {
  return request("/api/traffic-logs", { method: "DELETE" });
}
