import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TrafficLogConfig } from "../config/index.js";

const LOG_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const ROTATION_INTERVAL_MS = 15 * 60 * 1000;

export interface TrafficLogEvent {
  ts: string;
  token: string;
  profile: string;
  server: string;
  tool: string;
  namespacedTool: string;
  durationMs: number;
  outcome: "ok" | "error";
  errorCode?: number;
}

export interface TrafficLogFilters {
  from: number;
  to: number;
  token?: string;
  profile?: string;
  server?: string;
  tool?: string;
}

export interface TrafficLogQuery extends TrafficLogFilters {
  offset: number;
  limit: number;
}

export type TrafficLogGroupBy = "tool" | "server" | "token" | "profile";

export interface TrafficLogGroup {
  key: string;
  count: number;
  ok: number;
  error: number;
}

export class TrafficLog {
  private config: TrafficLogConfig;
  private readonly directory: string;
  private pending: Promise<void> = Promise.resolve();
  private rotationTimer?: NodeJS.Timeout;
  private dropped = 0;

  constructor(
    config: TrafficLogConfig,
    directory = join(homedir(), ".omni-mcp", "traffic"),
  ) {
    this.config = config;
    this.directory = directory;
  }

  start(): void {
    if (this.rotationTimer) return;
    this.rotationTimer = setInterval(() => {
      void this.enqueue(async () => this.rotate()).catch(() => undefined);
    }, ROTATION_INTERVAL_MS);
    this.rotationTimer.unref();
    void this.enqueue(async () => this.rotate()).catch(() => undefined);
  }

  async stop(): Promise<void> {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = undefined;
    }
    await this.pending;
  }

  updateConfig(config: TrafficLogConfig): void {
    this.config = config;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  append(event: TrafficLogEvent): Promise<void> {
    if (!this.config.enabled) return Promise.resolve();

    return this.enqueue(async () => {
      const line = `${JSON.stringify(event)}\n`;
      if (Buffer.byteLength(line) > this.config.maxBytes) {
        this.dropped++;
        return;
      }

      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await this.rotate();
      await appendFile(
        join(this.directory, `${event.ts.slice(0, 10)}.jsonl`),
        line,
        { encoding: "utf8", mode: 0o600 },
      );
      await this.enforceSizeCap();
    });
  }

  async query(query: TrafficLogQuery): Promise<{
    events: TrafficLogEvent[];
    total: number;
    dropped: number;
  }> {
    if (!this.config.enabled) return { events: [], total: 0, dropped: this.dropped };
    await this.pending;

    const matching = (await this.readEvents())
      .filter((event) => matches(event, query))
      .sort((a, b) => b.ts.localeCompare(a.ts));

    return {
      events: matching.slice(query.offset, query.offset + query.limit),
      total: matching.length,
      dropped: this.dropped,
    };
  }

  async summarize(
    filters: TrafficLogFilters,
    groupBy: TrafficLogGroupBy,
  ): Promise<{
    groupBy: TrafficLogGroupBy;
    groups: TrafficLogGroup[];
    totalEvents: number;
    truncated?: true;
  }> {
    if (!this.config.enabled) {
      return { groupBy, groups: [], totalEvents: 0 };
    }
    await this.pending;

    const events = (await this.readEvents()).filter((event) => matches(event, filters));
    const grouped = new Map<string, TrafficLogGroup>();
    for (const event of events) {
      const key = groupBy === "tool" ? event.namespacedTool : event[groupBy];
      const group = grouped.get(key) ?? { key, count: 0, ok: 0, error: 0 };
      group.count++;
      group[event.outcome]++;
      grouped.set(key, group);
    }

    const allGroups = [...grouped.values()].sort(
      (a, b) => b.count - a.count || a.key.localeCompare(b.key),
    );
    const result: {
      groupBy: TrafficLogGroupBy;
      groups: TrafficLogGroup[];
      totalEvents: number;
      truncated?: true;
    } = {
      groupBy,
      groups: allGroups.slice(0, 500),
      totalEvents: events.length,
    };
    if (allGroups.length > 500) result.truncated = true;
    return result;
  }

  clear(): Promise<void> {
    return this.enqueue(async () => {
      await rm(this.directory, { recursive: true, force: true });
      this.dropped = 0;
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.pending.then(operation, operation);
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async readEvents(): Promise<TrafficLogEvent[]> {
    const files = await this.logFiles();
    const events: TrafficLogEvent[] = [];
    for (const file of files) {
      const content = await readFile(join(this.directory, file), "utf8").catch(() => "");
      for (const line of content.split("\n")) {
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as TrafficLogEvent;
          if (isTrafficLogEvent(parsed)) events.push(parsed);
        } catch {
          // Ignore a partial final line left by an interrupted append.
        }
      }
    }
    return events;
  }

  private async rotate(): Promise<void> {
    const files = await this.logFiles();
    if (files.length === 0) return;

    const cutoff = new Date();
    cutoff.setUTCHours(0, 0, 0, 0);
    cutoff.setUTCDate(cutoff.getUTCDate() - this.config.retentionDays);
    const cutoffDate = cutoff.toISOString().slice(0, 10);

    for (const file of files) {
      if (file.slice(0, 10) < cutoffDate) {
        await rm(join(this.directory, file), { force: true });
      }
    }
    await this.enforceSizeCap();
  }

  private async enforceSizeCap(): Promise<void> {
    const files = await this.logFiles();
    if (files.length === 0) return;

    const sizes = new Map<string, number>();
    let total = 0;
    for (const file of files) {
      const size = (await stat(join(this.directory, file))).size;
      sizes.set(file, size);
      total += size;
    }

    const newest = files.at(-1)!;
    for (const file of files.slice(0, -1)) {
      if (total <= this.config.maxBytes) break;
      const content = await readFile(join(this.directory, file), "utf8").catch(() => "");
      this.dropped += content.split("\n").filter(Boolean).length;
      await rm(join(this.directory, file), { force: true });
      total -= sizes.get(file) ?? 0;
    }

    if (total <= this.config.maxBytes) return;

    const newestPath = join(this.directory, newest);
    const lines = (await readFile(newestPath, "utf8")).split("\n").filter(Boolean);
    const kept: string[] = [];
    let keptBytes = 0;
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = `${lines[index]}\n`;
      const bytes = Buffer.byteLength(line);
      if (keptBytes + bytes > this.config.maxBytes) break;
      kept.unshift(line);
      keptBytes += bytes;
    }
    this.dropped += lines.length - kept.length;
    await writeFile(newestPath, kept.join(""), "utf8");
  }

  private async logFiles(): Promise<string[]> {
    const entries = await readdir(this.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    return entries.filter((entry) => LOG_FILE_PATTERN.test(entry)).sort();
  }
}

function matches(event: TrafficLogEvent, filters: TrafficLogFilters): boolean {
  const time = Date.parse(event.ts);
  return (
    time >= filters.from &&
    time <= filters.to &&
    (filters.token === undefined || event.token === filters.token) &&
    (filters.profile === undefined || event.profile === filters.profile) &&
    (filters.server === undefined || event.server === filters.server) &&
    (filters.tool === undefined || event.tool === filters.tool)
  );
}

function isTrafficLogEvent(value: TrafficLogEvent): boolean {
  return (
    typeof value?.ts === "string" &&
    typeof value.token === "string" &&
    typeof value.profile === "string" &&
    typeof value.server === "string" &&
    typeof value.tool === "string" &&
    typeof value.namespacedTool === "string" &&
    typeof value.durationMs === "number" &&
    (value.outcome === "ok" || value.outcome === "error")
  );
}
