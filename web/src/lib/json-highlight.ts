export type JsonTokenClass =
  | "json-token-key"
  | "json-token-string"
  | "json-token-number"
  | "json-token-boolean"
  | "json-token-null"
  | "json-token-punctuation"
  | null;

export interface JsonToken {
  text: string;
  className: JsonTokenClass;
}

const JSON_PATTERN =
  /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]/g;

function classify(text: string, source: string, endIndex: number): JsonTokenClass {
  if (text.startsWith('"')) {
    let index = endIndex;
    while (index < source.length && /\s/.test(source[index])) index += 1;
    return source[index] === ":" ? "json-token-key" : "json-token-string";
  }
  if (text === "true" || text === "false") return "json-token-boolean";
  if (text === "null") return "json-token-null";
  if (/^[{}[\],:]$/.test(text)) return "json-token-punctuation";
  return "json-token-number";
}

// Splits source into styled spans while preserving every character, so an
// overlay stays glyph-for-glyph aligned with a textarea rendered on top of it.
export function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  JSON_PATTERN.lastIndex = 0;
  while ((match = JSON_PATTERN.exec(source)) !== null) {
    if (match.index > last) {
      tokens.push({ text: source.slice(last, match.index), className: null });
    }
    const end = match.index + match[0].length;
    tokens.push({ text: match[0], className: classify(match[0], source, end) });
    last = end;
  }
  if (last < source.length) {
    tokens.push({ text: source.slice(last), className: null });
  }
  return tokens;
}

export function findJsonError(value: string): { message: string; line: number } | null {
  if (!value.trim()) return null;
  try {
    JSON.parse(value);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    const lineMatch = /line (\d+)/i.exec(message);
    if (lineMatch) return { message, line: Number(lineMatch[1]) };
    const positionMatch = /position (\d+)/i.exec(message);
    if (positionMatch) {
      const line = value.slice(0, Number(positionMatch[1])).split("\n").length;
      return { message, line };
    }
    return { message, line: 1 };
  }
}
