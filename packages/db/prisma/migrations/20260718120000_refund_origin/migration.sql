-- Refund origin (#214): distinguish the automatic partial refund a staff item-removal
-- creates from customer help-ticket / cancellation refunds, so the help-ticket
-- idempotency guard doesn't treat an item-removal refund as "already refunded".
-- Legacy rows default to 'other', which the guard still treats as blocking.
CREATE TYPE "RefundOrigin" AS ENUM ('item_removal', 'help_ticket', 'cancellation', 'other');
ALTER TABLE "refunds" ADD COLUMN "origin" "RefundOrigin" NOT NULL DEFAULT 'other';
