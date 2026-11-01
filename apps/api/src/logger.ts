import { pino } from "pino";

export const logger = pino({
  name: "@installments/api",
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "password",
      "currentPassword",
      "newPassword",
      "accessToken",
      "refreshToken",
    ],
    censor: "[REDACTED]",
  },
});
