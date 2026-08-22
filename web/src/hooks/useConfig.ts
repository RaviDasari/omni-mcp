import { useCallback, useEffect, useState } from "react";
import { fetchConfig } from "@/lib/api";
import type { OmniMcpConfig } from "@/lib/types";

export function useConfig() {
  const [config, setConfig] = useState<OmniMcpConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchConfig();
      setConfig(result.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { config, setConfig, error, loading, refresh };
}
