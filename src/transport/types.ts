export type ServerStatus = "connecting" | "connected" | "error" | "disabled";

export interface Tool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ServerAdapter {
  readonly name: string;
  readonly status: ServerStatus;
  readonly restarts: number;

  connect(): Promise<void>;
  listTools(): Promise<Tool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  disconnect(): Promise<void>;
}
