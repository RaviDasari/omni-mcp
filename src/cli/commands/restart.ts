import { readPidFile } from "../pid.js";
import { startCommand, type StartOptions } from "./start.js";
import { assertRunningConfig } from "../lifecycle.js";

interface RestartOptions extends Omit<StartOptions, "foreground"> {
  config: string;
}

export async function restartCommand(options: RestartOptions): Promise<void> {
  const pid = readPidFile();

  if (pid) {
    process.stdout.write(`[omni-mcp] Stopping existing instance (PID ${pid})...\n`);
    try {
      await assertRunningConfig(options.config, pid);
      process.kill(pid, "SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      process.stdout.write("[omni-mcp] Stopped.\n");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        process.stdout.write("[omni-mcp] Previous process already exited (stale PID).\n");
      } else {
        const message = err instanceof Error ? err.message : "Unknown error";
        process.stderr.write(`[omni-mcp] Cannot restart: ${message}\n`);
        process.exitCode = 1;
        return;
      }
    }
  } else {
    process.stdout.write("[omni-mcp] No running instance found, starting fresh...\n");
  }

  await startCommand({ ...options, foreground: false });
}
