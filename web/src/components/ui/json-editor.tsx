import * as React from "react";

import { cn } from "@/lib/utils";

type TokenClass =
  | "json-token-key"
  | "json-token-string"
  | "json-token-number"
  | "json-token-boolean"
  | "json-token-null"
  | "json-token-punctuation"
  | null;

interface Token {
  text: string;
  className: TokenClass;
}

const JSON_PATTERN =
  /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]/g;

const INDENT = "  ";

function classify(text: string, source: string, endIndex: number): TokenClass {
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

// Splits source into styled spans while preserving every character, so the
// overlay stays glyph-for-glyph aligned with the textarea on top of it.
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
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

function findError(value: string): { message: string; line: number } | null {
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

// Applied identically to the textarea and the highlight overlay; any divergence
// here shows up as drifting glyphs between the two layers.
const SHARED_TEXT_STYLE =
  "m-0 border-0 px-3 py-2 font-mono text-xs leading-5 tracking-normal whitespace-pre";

export interface JsonEditorProps
  extends Omit<React.ComponentPropsWithoutRef<"textarea">, "onChange" | "value"> {
  value: string;
  onValueChange: (value: string) => void;
  minRows?: number;
  showLineNumbers?: boolean;
  containerClassName?: string;
}

export const JsonEditor = React.forwardRef<HTMLTextAreaElement, JsonEditorProps>(
  (
    {
      value,
      onValueChange,
      minRows = 16,
      showLineNumbers = true,
      containerClassName,
      className,
      onScroll,
      onKeyDown,
      ...props
    },
    forwardedRef,
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const highlightRef = React.useRef<HTMLPreElement | null>(null);
    const gutterRef = React.useRef<HTMLDivElement | null>(null);

    React.useImperativeHandle(forwardedRef, () => textareaRef.current as HTMLTextAreaElement);

    const tokens = React.useMemo(() => tokenize(value), [value]);
    const error = React.useMemo(() => findError(value), [value]);
    const lineCount = React.useMemo(() => value.split("\n").length, [value]);

    const syncScroll = React.useCallback((event: React.UIEvent<HTMLTextAreaElement>) => {
      const { scrollTop, scrollLeft } = event.currentTarget;
      if (highlightRef.current) {
        highlightRef.current.scrollTop = scrollTop;
        highlightRef.current.scrollLeft = scrollLeft;
      }
      if (gutterRef.current) {
        gutterRef.current.scrollTop = scrollTop;
      }
      onScroll?.(event);
    }, [onScroll]);

    // Writing through execCommand keeps the browser's native undo stack intact;
    // setting state directly would discard it.
    const insertText = React.useCallback(
      (text: string) => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        if (!document.execCommand("insertText", false, text)) {
          const { selectionStart, selectionEnd } = textarea;
          onValueChange(value.slice(0, selectionStart) + text + value.slice(selectionEnd));
        }
      },
      [onValueChange, value],
    );

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== "Tab") return;

        const textarea = event.currentTarget;
        const { selectionStart, selectionEnd } = textarea;
        event.preventDefault();

        if (!event.shiftKey && selectionStart === selectionEnd) {
          insertText(INDENT);
          return;
        }

        const startOfFirstLine = value.lastIndexOf("\n", selectionStart - 1) + 1;
        const endOfLast = value.indexOf("\n", selectionEnd);
        const endOfLastLine = endOfLast === -1 ? value.length : endOfLast;
        const block = value.slice(startOfFirstLine, endOfLastLine);
        const shifted = event.shiftKey
          ? block.replace(/^[ \t]{1,2}/gm, "")
          : block.replace(/^/gm, INDENT);

        if (shifted === block) return;

        textarea.setSelectionRange(startOfFirstLine, endOfLastLine);
        insertText(shifted);
        requestAnimationFrame(() => {
          textarea.setSelectionRange(startOfFirstLine, startOfFirstLine + shifted.length);
        });
      },
      [insertText, onKeyDown, value],
    );

    const gutterDigits = String(lineCount).length;

    return (
      <div className="grid gap-1">
        <div
          className={cn(
            "relative flex overflow-hidden rounded-md border bg-background",
            "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background",
            error && "border-destructive/60",
            containerClassName,
          )}
        >
          {showLineNumbers ? (
            <div
              ref={gutterRef}
              aria-hidden
              className={cn(
                SHARED_TEXT_STYLE,
                "select-none overflow-hidden border-r bg-[var(--json-gutter)] px-2 text-right text-muted-foreground",
              )}
              style={{ minWidth: `${gutterDigits + 2}ch` }}
            >
              {Array.from({ length: lineCount }, (_, index) => (
                <div key={index} className={cn(error?.line === index + 1 && "text-destructive font-medium")}>
                  {index + 1}
                </div>
              ))}
            </div>
          ) : null}

          <div className="relative min-w-0 flex-1">
            <pre
              ref={highlightRef}
              aria-hidden
              className={cn(SHARED_TEXT_STYLE, "pointer-events-none absolute inset-0 overflow-hidden")}
            >
              <code>
                {tokens.map((token, index) => (
                  <span key={index} className={token.className ?? undefined}>
                    {token.text}
                  </span>
                ))}
              </code>
            </pre>
            <textarea
              {...props}
              ref={textareaRef}
              value={value}
              rows={minRows}
              wrap="off"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              onChange={(event) => onValueChange(event.target.value)}
              onScroll={syncScroll}
              onKeyDown={handleKeyDown}
              className={cn(
                SHARED_TEXT_STYLE,
                "relative block h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-foreground outline-none",
                "selection:bg-primary/30 selection:text-transparent",
                className,
              )}
            />
          </div>
        </div>

        {error ? (
          <p className="text-xs text-destructive" role="status">
            Line {error.line}: {error.message}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Valid JSON · Tab indents, Shift+Tab outdents
          </p>
        )}
      </div>
    );
  },
);

JsonEditor.displayName = "JsonEditor";
