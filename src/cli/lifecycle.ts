import { resolve } from "node:path";
import { GatewayClient, gatewayUrlFromConfig } from "./http-client.js";
import { readRuntimeMetadata } from "./pid.js";

export async function assertRunningConfig(configPath: string, pid?: number): Promise<void> {
  const selected = resolve(configPath);
  const runtime = readRuntimeMetadata();
  if (runtime && (pid === undefined || runtime.pid === pid)) {
    const running = resolve(runtime.configPath);
    if (running !== selected) {
      throw new Error(`Running instance uses ${running}, not ${selected}`);
    }
    return;
  }

  const client = new GatewayClient(gatewayUrlFromConfig(configPath));
  const health = await client.health();
  const running = health.configPath ? resolve(health.configPath) : undefined;
  if (running !== selected) {
    throw new Error(
      `Running instance uses ${running ?? "an unknown config path"}, not ${selected}`,
    );
  }
}
