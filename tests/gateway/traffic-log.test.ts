import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TrafficLog, type TrafficLogEvent } from "../../src/gateway/traffic-log.js";

const logs: TrafficLog[] = [];

function createLog(
  overrides: Partial<{ enabled: boolean; retentionDays: number; maxBytes: number }> = {},
): { log: TrafficLog; directory: string } {
  const directory = mkdtempSync(join(tmpdir(), "omni-mcp-traffic-"));
  const log = new TrafficLog(
    { enabled: true, retentionDays: 7, maxBytes: 5242880, ...overrides },
    directory,
  );
  logs.push(log);
  return { log, directory };
}

function event(overrides: Partial<TrafficLogEvent> = {}): TrafficLogEvent {
  return {
    ts: new Date().toISOString(),
    token: "cursor",
    profile: "admin",
    server: "filesystem",
    tool: "read_file",
    namespacedTool: "filesystem__read_file",
    durationMs: 12,
    outcome: "ok",
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(logs.splice(0).map((log) => log.stop()));
});

describe("TrafficLog", () => {
  it("stores only the provided metadata and filters records", async () => {
    const { log, directory } = createLog();
    const ts = new Date().toISOString();
    await log.append(event({ ts }));
    await log.append(event({
      ts: new Date(Date.now() - 1000).toISOString(),
      token: "claude",
      server: "github",
      tool: "list_issues",
      namespacedTool: "github__list_issues",
      outcome: "error",
      errorCode: -32603,
    }));

    const result = await log.query({
      from: Date.now() - 60_000,
      to: Date.now() + 60_000,
      token: "cursor",
      offset: 0,
      limit: 100,
    });
    expect(result.total).toBe(1);
    expect(result.events[0]).toMatchObject({ tool: "read_file", outcome: "ok" });

    const raw = readFileSync(join(directory, `${ts.slice(0, 10)}.jsonl`), "utf8");
    expect(raw).not.toContain("arguments");
    expect(raw).not.toContain("result");
    expect(raw).not.toContain("message");
  });

  it("groups matching records and separates namespaced tools", async () => {
    const { log } = createLog();
    await log.append(event());
    await log.append(event({ outcome: "error", errorCode: -32603 }));
    await log.append(event({
      server: "github",
      namespacedTool: "github__read_file",
    }));

    const result = await log.summarize(
      { from: Date.now() - 60_000, to: Date.now() + 60_000 },
      "tool",
    );
    expect(result.totalEvents).toBe(3);
    expect(result.groups).toEqual([
      { key: "filesystem__read_file", count: 2, ok: 1, error: 1 },
      { key: "github__read_file", count: 1, ok: 1, error: 0 },
    ]);
  });

  it("deletes files outside retention on the next append", async () => {
    const { log, directory } = createLog({ retentionDays: 7 });
    writeFileSync(join(directory, "2020-01-01.jsonl"), `${JSON.stringify(event({
      ts: "2020-01-01T00:00:00.000Z",
    }))}\n`);

    await log.append(event());

    const oldContents = readFileSync(join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`), "utf8");
    expect(oldContents).toContain("filesystem__read_file");
    const result = await log.query({
      from: 0,
      to: Date.now() + 60_000,
      offset: 0,
      limit: 100,
    });
    expect(result.total).toBe(1);
  });

  it("keeps disk usage under the configured cap by dropping oldest lines", async () => {
    const maxBytes = 65536;
    const { log, directory } = createLog({ maxBytes });
    for (let index = 0; index < 120; index++) {
      await log.append(event({
        ts: new Date(Date.now() + index).toISOString(),
        tool: `${index}-${"x".repeat(600)}`,
        namespacedTool: `filesystem__${index}-${"x".repeat(600)}`,
      }));
    }

    const filename = `${new Date().toISOString().slice(0, 10)}.jsonl`;
    expect(Buffer.byteLength(readFileSync(join(directory, filename)))).toBeLessThanOrEqual(maxBytes);
    const result = await log.query({
      from: Date.now() - 60_000,
      to: Date.now() + 60_000,
      offset: 0,
      limit: 200,
    });
    expect(result.total).toBeLessThan(120);
    expect(result.dropped).toBeGreaterThan(0);
  });

  it("returns no events when disabled", async () => {
    const { log } = createLog({ enabled: false });
    await log.append(event());
    expect(await log.query({
      from: 0,
      to: Date.now() + 60_000,
      offset: 0,
      limit: 100,
    })).toEqual({ events: [], total: 0, dropped: 0 });
  });
});
