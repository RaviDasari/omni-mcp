export interface StdioServerConfig {
  type: "stdio";
  enabled?: boolean;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  maxRestarts?: number;
  restartBackoffMs?: number;
  callTimeoutMs?: number;
  hangThreshold?: number;
}

export interface HttpServerConfig {
  type: "http";
  enabled?: boolean;
  url: string;
  auth?: { type: "jwt"; token: string };
  timeoutMs?: number;
  retries?: number;
  retryBackoffMs?: number;
  reconnectIntervalMs?: number;
}

export type ServerConfig = StdioServerConfig | HttpServerConfig;

export interface ProfileConfig {
  allow: string[];
}

export interface TokenConfig {
  profile: string;
  description?: string;
  disabled?: boolean;
}

export interface OmniMcpConfig {
  port: number;
  host: string;
  defaultProfile: string;
  shutdownGracePeriodMs: number;
  servers: Record<string, ServerConfig>;
  profiles: Record<string, ProfileConfig>;
  tokens: Record<string, TokenConfig>;
  security: { unknownTokenPolicy: "fallback-to-default" | "reject" };
  trafficLog: {
    enabled: boolean;
    retentionDays: number;
    maxBytes: number;
  };
}

export interface HealthPayload {
  status: string;
  version: string;
  uptime: number;
  host: string;
  port: number;
  configPath?: string;
  defaultProfile: string;
  servers: Record<
    string,
    { enabled: boolean; status: string; transport: string; restarts: number }
  >;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

export interface ServerToolsResponse {
  server: string;
  status: string;
  transport: string;
  restarts: number;
  tools: McpTool[];
}

export interface ServerToolCallResponse {
  server: string;
  tool: string;
  durationMs: number;
  result: McpToolResult;
}

export interface IdeSnippet {
  id: string;
  title: string;
  pathHint: string;
  json: string;
}

export interface IdeSnippetsResult {
  url: string;
  token: string;
  snippets: IdeSnippet[];
  curl: string;
}

export interface TrafficLogEvent {
  ts: string;
  token: string;
  profile: string;
  server: string;
  tool: string;
  namespacedTool: string;
  durationMs: number;
  outcome: "ok" | "error";
  errorCode?: number;
}

export interface TrafficLogListResponse {
  events: TrafficLogEvent[];
  total: number;
  dropped: number;
}

export type TrafficLogGroupBy = "tool" | "server" | "token" | "profile";

export interface TrafficLogSummaryResponse {
  groupBy: TrafficLogGroupBy;
  groups: Array<{
    key: string;
    count: number;
    ok: number;
    error: number;
  }>;
  totalEvents: number;
  truncated?: boolean;
}
