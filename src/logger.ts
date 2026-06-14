export type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let globalLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  globalLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLevel;
}

export class Logger {
  private source: string;

  constructor(source: string) {
    this.source = source;
  }

  error(message: string): void {
    this.log("error", message);
  }

  warn(message: string): void {
    this.log("warn", message);
  }

  info(message: string): void {
    this.log("info", message);
  }

  debug(message: string): void {
    this.log("debug", message);
  }

  private log(level: LogLevel, message: string): void {
    if (LOG_LEVELS[level] > LOG_LEVELS[globalLevel]) return;

    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const line = `[${this.source}] ${timestamp} ${levelStr} ${message}`;

    if (level === "error") {
      process.stderr.write(line + "\n");
    } else {
      process.stdout.write(line + "\n");
    }
  }
}
