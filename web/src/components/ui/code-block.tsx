import * as React from "react";
import { Check, Copy } from "lucide-react";

import { tokenizeJson } from "@/lib/json-highlight";
import { cn } from "@/lib/utils";

export interface CodeBlockProps {
  code: string;
  language?: "json" | "bash";
  className?: string;
  copyable?: boolean;
}

export function CodeBlock({ code, language = "json", className, copyable = true }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const tokens = React.useMemo(
    () => (language === "json" ? tokenizeJson(code) : null),
    [code, language],
  );

  return (
    <div className={cn("code-surface group relative rounded-md border", className)}>
      {copyable ? (
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? "Copied" : "Copy code"}
          className="absolute right-2 top-2 rounded-md border border-white/15 bg-white/5 p-1.5 text-[var(--code-foreground)]/70 opacity-0 transition hover:bg-white/10 hover:text-[var(--code-foreground)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 group-hover:opacity-100"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      ) : null}
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-5">
        <code>
          {tokens
            ? tokens.map((token, index) => (
                <span key={index} className={token.className ?? undefined}>
                  {token.text}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}
