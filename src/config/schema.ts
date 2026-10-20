import { z } from "zod";

// --- Server schemas ---

const envVarsSchema = z.record(z.string(), z.string());

const serverCliSchema = z.object({
  enabled: z.boolean().default(false),
});

const serverToonSchema = z.object({
  enabled: z.boolean().default(false),
});

const toolNamesSchema = z
  .array(z.string().trim().min(1, "tool name must not be empty"))
  .transform((names) => [...new Set(names)]);

const stdioServerSchema = z.object({
  type: z.literal("stdio"),
  enabled: z.boolean().default(true),
  cli: serverCliSchema.default({ enabled: false }),
  toon: serverToonSchema.default({ enabled: false }),
  disabledTools: toolNamesSchema.optional(),
  command: z.string().min(1, "command is required"),
  args: z.array(z.string()).default([]),
  maxRestarts: z.number().int().min(0).default(3),
  restartBackoffMs: z.number().int().min(0).default(1000),
  callTimeoutMs: z.number().int().min(0).default(60000),
  hangThreshold: z.number().int().min(1).default(3),
  cwd: z.string().optional(),
  env: envVarsSchema.optional(),
});

const httpAuthSchema = z.object({
  type: z.literal("jwt"),
  token: z.string().min(1, "auth.token is required"),
});

const httpServerSchema = z.object({
  type: z.literal("http"),
  enabled: z.boolean().default(true),
  cli: serverCliSchema.default({ enabled: false }),
  toon: serverToonSchema.default({ enabled: false }),
  disabledTools: toolNamesSchema.optional(),
  url: z.string().url("url must be a valid URL"),
  auth: httpAuthSchema.optional(),
  timeoutMs: z.number().int().min(0).default(30000),
  retries: z.number().int().min(0).default(2),
  retryBackoffMs: z.number().int().min(0).default(500),
  reconnectIntervalMs: z.number().int().min(0).default(30000),
});

const serverSchema = z.discriminatedUnion("type", [
  stdioServerSchema,
  httpServerSchema,
]);

// --- Profile schema ---

const profileSchema = z.object({
  allow: z.array(z.string()).min(1, "allow must contain at least one entry"),
  denyTools: z.record(z.string(), toolNamesSchema).optional(),
});

// --- Token schema ---

const tokenSchema = z
  .object({
    profiles: z.array(z.string().min(1)).min(1, "profiles must contain at least one entry").optional(),
    profile: z.string().min(1).optional(),
    description: z.string().optional(),
    disabled: z.boolean().default(false),
  })
  .refine((token) => token.profiles !== undefined || token.profile !== undefined, {
    message: "profiles is required",
  })
  .refine((token) => !(token.profiles !== undefined && token.profile !== undefined), {
    message: "use profiles or legacy profile, not both",
  });

// --- Security schema ---

const securitySchema = z.object({
  unknownTokenPolicy: z
    .enum(["fallback-to-default", "reject"])
    .default("fallback-to-default"),
});

// --- Traffic log schema ---

const trafficLogSchema = z.object({
  enabled: z.boolean().default(true),
  retentionDays: z.number().int().min(1).max(30).default(7),
  maxBytes: z.number().int().min(65536).max(52428800).default(5242880),
});

const secretBackendSchema = z.object({
  backend: z.enum(["file", "keychain"]).default("file"),
  keychainService: z.literal("omni-mcp").default("omni-mcp"),
});

// --- Top-level config schema ---

export const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(6317),
  host: z.string().default("127.0.0.1"),
  defaultProfile: z.string().default("default"),
  shutdownGracePeriodMs: z.number().int().min(0).default(10000),
  servers: z.record(z.string(), serverSchema).refine(
    (servers) => Object.keys(servers).length >= 1,
    { message: "At least one server must be defined" },
  ),
  profiles: z.record(z.string(), profileSchema).refine(
    (profiles) => "default" in profiles,
    { message: 'A "default" profile is required' },
  ),
  tokens: z.record(z.string(), tokenSchema).refine(
    (tokens) => "default" in tokens,
    { message: 'A "default" token is required' },
  ),
  security: securitySchema.default({ unknownTokenPolicy: "fallback-to-default" }),
  trafficLog: trafficLogSchema.default({
    enabled: true,
    retentionDays: 7,
    maxBytes: 5242880,
  }),
  secretBackend: secretBackendSchema.default({
    backend: "file",
    keychainService: "omni-mcp",
  }),
});

// --- Exported types ---

export type StdioServerConfig = z.infer<typeof stdioServerSchema>;
export type HttpServerConfig = z.infer<typeof httpServerSchema>;
export type ServerConfig = z.infer<typeof serverSchema>;
export type ProfileConfig = z.infer<typeof profileSchema>;
export type TokenConfig = z.infer<typeof tokenSchema>;
export type SecurityConfig = z.infer<typeof securitySchema>;
export type TrafficLogConfig = z.infer<typeof trafficLogSchema>;
export type SecretBackendConfig = z.infer<typeof secretBackendSchema>;
export type OmniMcpConfig = z.infer<typeof configSchema>;
