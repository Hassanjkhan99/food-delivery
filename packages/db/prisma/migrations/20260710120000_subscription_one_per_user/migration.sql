-- One active subscription row per user (follow-up #123): prevents concurrent
-- first-time subscribes from both creating a row and double-charging.

-- Defensive de-dup first: if any environment already accumulated duplicate rows for a user
-- (e.g. from the very race this migration closes), the unique index below would otherwise
-- fail to build. Keep the best row per user (active first, then latest period, then newest)
-- and drop the rest before enforcing the constraint.
DELETE FROM "subscriptions" s
USING (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY "userId"
    ORDER BY ("status" = 'active') DESC, "currentPeriodEnd" DESC, "createdAt" DESC
  ) AS rn
  FROM "subscriptions"
) ranked
WHERE s.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");
