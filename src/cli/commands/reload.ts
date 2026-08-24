import { readPidFile } from "../pid.js";
import { matchingGateway } from "../http-client.js";

interface ReloadOptions {
  config: string;
  gatewayUrl?: string;
  json?: boolean;
}

export async function reloadCommand(options: ReloadOptions): Promise<void> {
  const pid = readPidFile();

  try {
    const live = await matchingGateway(options.config, options.gatewayUrl);
    if (!live) throw new Error("No running gateway uses the selected config");
    const result = await live.client.request("/api/reload", { method: "POST" });
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else process.stdout.write(pid
      ? `[omni-mcp] Reload complete for PID ${pid}.\n`
      : "[omni-mcp] Reload complete.\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      process.stderr.write("[omni-mcp] Process not found (stale PID file).\n");
    } else {
      const message = err instanceof Error ? err.message : "Unknown error";
      process.stderr.write(`[omni-mcp] Failed to reload: ${message}\n`);
    }
    process.exit(1);
  }
}
