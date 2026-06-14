import type { OmniMcpConfig } from "./schema.js";

export interface EnvResolutionError {
  path: string;
  variable: string;
}

/**
 * Resolves all $VAR_NAME references in the config object using process.env.
 * Returns the resolved config and any errors for missing variables.
 * Literal $$ is unescaped to a single $.
 */
export function resolveEnvVariables(
  config: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
): { resolved: Record<string, unknown>; errors: EnvResolutionError[] } {
  const errors: EnvResolutionError[] = [];
  const resolved = deepResolve(config, "", env, errors);
  return { resolved: resolved as Record<string, unknown>, errors };
}

function deepResolve(
  value: unknown,
  path: string,
  env: Record<string, string | undefined>,
  errors: EnvResolutionError[],
): unknown {
  if (typeof value === "string") {
    return resolveString(value, path, env, errors);
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => deepResolve(item, `${path}[${i}]`, env, errors));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const newPath = path ? `${path}.${key}` : key;
      result[key] = deepResolve(val, newPath, env, errors);
    }
    return result;
  }

  return value;
}

function resolveString(
  value: string,
  path: string,
  env: Record<string, string | undefined>,
  errors: EnvResolutionError[],
): string {
  // Handle escaped $$ → literal $
  if (value.startsWith("$$")) {
    return value.slice(1);
  }

  // Handle $VAR_NAME references
  if (value.startsWith("$")) {
    const varName = value.slice(1);
    const resolved = env[varName];
    if (resolved === undefined || resolved === "") {
      errors.push({ path, variable: varName });
      return value; // Return original for error reporting
    }
    return resolved;
  }

  return value;
}

/**
 * Formats environment resolution errors into a human-readable list.
 */
export function formatEnvErrors(errors: EnvResolutionError[]): string[] {
  return errors.map(
    (e) => `${e.path} references "$${e.variable}" but the environment variable ${e.variable} is not set`,
  );
}
