import { encode } from "@toon-format/toon";
import type { ToolResult } from "./transport/types.js";

/**
 * Convert a JSON object/array document to TOON. Returns undefined when the
 * text is not a JSON object/array or when TOON would not be shorter.
 */
export function toToon(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const encoded = encode(parsed);
  return encoded.length > 0 && encoded.length < text.length ? encoded : undefined;
}

/** Encode an already-parsed value, falling back to JSON when TOON is not shorter. */
export function encodeValue(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  if (value === null || typeof value !== "object") return json;
  const encoded = encode(value);
  return encoded.length < JSON.stringify(value).length ? encoded : json;
}

/**
 * Return a copy of the result with JSON text content rewritten as TOON.
 * structuredContent and non-text items are left untouched so clients can still
 * validate against an outputSchema.
 */
export function toonifyResult(result: ToolResult): ToolResult {
  if (!Array.isArray(result.content)) return result;
  return {
    ...result,
    content: result.content.map((item) => {
      if (item.type !== "text" || typeof item.text !== "string") return item;
      const converted = toToon(item.text);
      return converted === undefined ? item : { ...item, text: converted };
    }),
  };
}
