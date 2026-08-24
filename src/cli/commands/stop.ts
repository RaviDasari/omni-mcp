import { readPidFile } from "../pid.js";
import { assertRunningConfig } from "../lifecycle.js";

interface StopOptions {
  config: string;
}

export async function stopCommand(options: StopOptions): Promise<void> {
  const pid = readPidFile();

  if (!pid) {
    process.stderr.write("[omni-mcp] No running instance found.\n");
    process.exit(1);
  }

  try {
    await assertRunningConfig(options.config, pid);
    process.stdout.write(`[omni-mcp] Stopping process PID ${pid}...\n`);
    process.kill(pid, "SIGTERM");

    // Wait briefly for process to exit
    await new Promise((resolve) => setTimeout(resolve, 2000));
    process.stdout.write("[omni-mcp] Stopped.\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") {
      process.stdout.write("[omni-mcp] Process already stopped (stale PID file).\n");
    } else {
      const message = err instanceof Error ? err.message : "Unknown error";
      process.stderr.write(`[omni-mcp] Failed to stop: ${message}\n`);
      process.exit(1);
    }
  }
}
