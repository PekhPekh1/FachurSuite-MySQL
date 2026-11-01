/** Minimal structured logger for the web app (server-side). */
type Level = "info" | "warn" | "error";

export function log(level: Level, message: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...meta });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
};
