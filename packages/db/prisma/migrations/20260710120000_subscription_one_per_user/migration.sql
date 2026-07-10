-- One active subscription row per user (follow-up #123): prevents concurrent
-- first-time subscribes from both creating a row and double-charging.
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");
