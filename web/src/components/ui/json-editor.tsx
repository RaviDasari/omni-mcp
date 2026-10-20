import * as React from "react";

import { findJsonError, tokenizeJson } from "@/lib/json-highlight";
import { cn } from "@/lib/utils";

const INDENT = "  ";

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

    const tokens = React.useMemo(() => tokenizeJson(value), [value]);
    const error = React.useMemo(() => findJsonError(value), [value]);
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
