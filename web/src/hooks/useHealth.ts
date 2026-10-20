import { useCallback, useEffect, useState } from "react";
import { fetchHealth } from "@/lib/api";
import type { HealthPayload } from "@/lib/types";

/** Gateway health, refreshed periodically so config errors clear once fixed. */
export function useHealth(intervalMs = 10000): {
  health: HealthPayload | null;
  refresh: () => Promise<void>;
} {
  const [health, setHealth] = useState<HealthPayload | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHealth(await fetchHealth());
    } catch {
      // Keep the last known health; the page shows its own load errors.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    // Servers start asynchronously after a change, so check again shortly after.
    const onChanged = () => {
      void refresh();
      window.setTimeout(() => void refresh(), 2000);
    };
    window.addEventListener("omni:config-changed", onChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("omni:config-changed", onChanged);
    };
  }, [refresh, intervalMs]);

  return { health, refresh };
}
