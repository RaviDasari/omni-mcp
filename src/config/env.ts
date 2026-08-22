import type { SecretStore } from "./secret-store.js";

export interface EnvResolutionError {
  path: string;
  variable: string;
}

/**
 * Resolves exact $VAR_NAME and ${VAR_NAME} references using process.env,
 * then the active secret store.
 * Returns the resolved config and any errors for missing variables.
 * Literal $$ is unescaped to a single $.
 */
export function resolveEnvVariables(
  config: Record<string, unknown>,
  env: Record<string, string | undefined> = process.env,
  secrets?: Pick<SecretStore, "get">,
): { resolved: Record<string, unknown>; errors: EnvResolutionError[] } {
  const errors: EnvResolutionError[] = [];
  const resolved = deepResolve(config, "", env, secrets, errors);
  return { resolved: resolved as Record<string, unknown>, errors };
}

function deepResolve(
  value: unknown,
  path: string,
  env: Record<string, string | undefined>,
  secrets: Pick<SecretStore, "get"> | undefined,
  errors: EnvResolutionError[],
): unknown {
  if (typeof value === "string") {
    return resolveString(value, path, env, secrets, errors);
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => deepResolve(item, `${path}[${i}]`, env, secrets, errors));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const newPath = path ? `${path}.${key}` : key;
      result[key] = deepResolve(val, newPath, env, secrets, errors);
    }
    return result;
  }

  return value;
}

function resolveString(
  value: string,
  path: string,
  env: Record<string, string | undefined>,
  secrets: Pick<SecretStore, "get"> | undefined,
  errors: EnvResolutionError[],
): string {
  // Handle escaped $$ → literal $
  if (value.startsWith("$$")) {
    return value.slice(1);
  }

  // Handle exact $VAR_NAME and ${VAR_NAME} references.
  const match = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/) ??
    value.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (match) {
    const varName = match[1]!;
    const resolved = env[varName] || secrets?.get(varName);
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
