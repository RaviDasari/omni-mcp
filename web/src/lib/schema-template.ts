function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requiredFields(schema?: Record<string, unknown>): string[] {
  return Array.isArray(schema?.required)
    ? (schema.required as unknown[]).filter((field): field is string => typeof field === "string")
    : [];
}

/** Builds the starting arguments JSON for a tool: required fields typed, optional fields `null`. */
export function schemaTemplate(schema?: Record<string, unknown>): string {
  const value = schemaValue(schema, schema, new Set());
  return JSON.stringify(isRecord(value) ? value : {}, null, 2);
}

/** Optional fields are templated as `null`, which upstream servers should never receive. */
export function omitOptionalNulls(
  args: Record<string, unknown>,
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  const required = new Set(requiredFields(schema));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null && !required.has(key)) continue;
    result[key] = value;
  }
  return result;
}

/** Follows local `$ref` pointers such as `#/definitions/Foo` so nested schemas resolve. */
function resolveRef(
  schema: Record<string, unknown>,
  root: Record<string, unknown> | undefined,
  seen: Set<string>,
): Record<string, unknown> {
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/") || seen.has(ref)) return schema;
  seen.add(ref);

  let node: unknown = root;
  for (const segment of ref.slice(2).split("/")) {
    if (!isRecord(node)) return schema;
    node = node[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return isRecord(node) ? node : schema;
}

function firstBranch(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const branches = schema[key];
    if (Array.isArray(branches) && isRecord(branches[0])) return branches[0];
  }
  return undefined;
}

function knownValue(schema: Record<string, unknown>): { value: unknown } | undefined {
  if ("default" in schema) return { value: schema.default };
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return { value: schema.examples[0] };
  }
  if ("const" in schema) return { value: schema.const };
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return { value: schema.enum[0] };
  return undefined;
}

function schemaValue(
  schema: Record<string, unknown> | undefined,
  root: Record<string, unknown> | undefined,
  seen: Set<string>,
): unknown {
  if (!schema) return {};
  const resolved = resolveRef(schema, root, seen);

  const known = knownValue(resolved);
  if (known) return known.value;

  const branch = firstBranch(resolved);
  if (branch) return schemaValue(branch, root, new Set(seen));

  if (resolved.type === "object" || isRecord(resolved.properties)) {
    const properties = isRecord(resolved.properties) ? resolved.properties : {};
    const required = requiredFields(resolved).filter((name) => name in properties);
    const optional = Object.keys(properties).filter((name) => !required.includes(name));

    const value: Record<string, unknown> = {};
    for (const name of [...required, ...optional]) {
      const property = properties[name];
      if (!isRecord(property)) continue;
      value[name] = required.includes(name)
        ? schemaValue(property, root, new Set(seen))
        : (knownValue(resolveRef(property, root, new Set(seen)))?.value ?? null);
    }
    return value;
  }

  if (resolved.type === "array") return [];
  if (resolved.type === "boolean") return false;
  if (resolved.type === "integer" || resolved.type === "number") return 0;
  if (resolved.type === "string") return "";
  return null;
}
