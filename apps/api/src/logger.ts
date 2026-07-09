// Structured logging with redaction (pattern from the compliance project).
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["password", "token", "codeHash", "providerToken", "DATABASE_URL", "SESSION_SECRET"],
    censor: "[redacted]",
  },
});
