import { readPidFile } from "../pid.js";

interface ReloadOptions {
  config: string;
}

export async function reloadCommand(options: ReloadOptions): Promise<void> {
  const pid = readPidFile();

  if (!pid) {
    process.stderr.write("[omni-mcp] No running instance found.\n");
    process.exit(1);
  }

  try {
    process.kill(pid, "SIGHUP");
    process.stdout.write("[omni-mcp] Reload signal sent to PID " + pid + ".\n");
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
