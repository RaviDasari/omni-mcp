import * as React from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SecretInputProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "type" | "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  revealLabel?: string;
}

/**
 * Masked input for write-only values, with an explicit reveal toggle.
 *
 * Browsers and password managers autofill saved credentials into any
 * type="password" field, which would silently pre-fill a replacement secret
 * with an unrelated value. The field therefore stays readOnly until the user
 * interacts with it (autofill runs before that) and carries the opt-out
 * attributes understood by the common managers.
 */
export const SecretInput = React.forwardRef<HTMLInputElement, SecretInputProps>(
  (
    { value, onValueChange, revealLabel = "value", className, onFocus, onPointerDown, ...props },
    forwardedRef,
  ) => {
    const [revealed, setRevealed] = React.useState(false);
    const [locked, setLocked] = React.useState(true);

    const unlock = React.useCallback(() => setLocked(false), []);

    return (
      <div className="relative">
        <Input
          {...props}
          ref={forwardedRef}
          type={revealed ? "text" : "password"}
          value={value}
          readOnly={locked}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          data-protonpass-ignore
          data-form-type="other"
          onPointerDown={(event) => {
            unlock();
            onPointerDown?.(event);
          }}
          onFocus={(event) => {
            unlock();
            onFocus?.(event);
          }}
          onChange={(event) => onValueChange(event.target.value)}
          className={cn("pr-10", className)}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setRevealed((current) => !current)}
          aria-label={revealed ? `Hide ${revealLabel}` : `Show ${revealLabel}`}
          aria-pressed={revealed}
          title={revealed ? `Hide ${revealLabel}` : `Show ${revealLabel}`}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);

SecretInput.displayName = "SecretInput";
