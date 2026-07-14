-- Codex #109: backfill SLA timestamps for support tickets that predate the SLA columns.
-- The queue UI treats a NULL firstRespondedAt/resolvedAt as a still-running timer, so
-- pre-existing in_progress/resolved/closed tickets show FALSE SLA breaches. Best available
-- proxy for the missing timestamps is updatedAt (the last time the ticket was actioned).
-- Data-only + idempotent (guards on IS NULL), safe to run once on existing rows.

-- A non-open ticket has, by definition, been responded to at least once.
UPDATE "support_tickets"
SET "firstRespondedAt" = "updatedAt"
WHERE "firstRespondedAt" IS NULL
  AND "status" <> 'open';

-- A resolved/closed ticket has, by definition, been resolved.
UPDATE "support_tickets"
SET "resolvedAt" = "updatedAt"
WHERE "resolvedAt" IS NULL
  AND "status" IN ('resolved', 'closed');
