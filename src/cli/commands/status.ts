import { readPidFile } from "../pid.js";

interface StatusOptions {
  config: string;
  json?: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const pid = readPidFile();

  if (!pid) {
    process.stderr.write("[omni-mcp] No running instance found.\n");
    process.exit(1);
  }

  // Check if process is actually running
  try {
    process.kill(pid, 0);
  } catch {
    process.stderr.write("[omni-mcp] No running instance found (stale PID file).\n");
    process.exit(1);
  }

  // Query the health endpoint of the running instance
  try {
    const response = await fetch("http://127.0.0.1:6317/_health");
    const health = await response.json() as Record<string, unknown>;

    if (options.json) {
      process.stdout.write(JSON.stringify({ pid, ...health }, null, 2) + "\n");
    } else {
      process.stdout.write(`omni-mcp  v0.1.0  PID: ${pid}  Uptime: ${formatUptime(health.uptime as number)}\n`);
      process.stdout.write(`Listening: http://127.0.0.1:6317\n\n`);

      const servers = health.servers as Record<string, { status: string; transport: string; restarts: number }>;
      if (servers) {
        process.stdout.write("Servers:\n");
        process.stdout.write("  NAME            TYPE   STATUS     RESTARTS\n");
        for (const [name, info] of Object.entries(servers)) {
          process.stdout.write(
            `  ${name.padEnd(15)} ${info.transport.padEnd(6)} ${info.status.padEnd(10)} ${info.restarts ?? "—"}\n`,
          );
        }
      }
    }
  } catch {
    process.stderr.write("[omni-mcp] Failed to reach running instance.\n");
    process.exit(1);
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
