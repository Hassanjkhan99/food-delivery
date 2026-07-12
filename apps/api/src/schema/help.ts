// Help-center domain (#45): order-contextual self-service. Customers file a
// categorized help ticket against an order; missing/wrong-item complaints attach
// the exact items and open a pending Refund prefilled with the selected item
// lineTotals so the admin refund workbench can act on real data. The customer sees
// the ticket status + resolutionNote (written when the linked refund is decided)
// without contacting anyone. Reuses SupportTicket + Refund — no new thread model yet.
import { prisma, Prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { HELP_CATEGORIES, helpCategory } from "@fd/shared";
import { builder } from "./builder.js";

// Customer-visible view of a support ticket. Only fields safe to show the owner.
// Note: the SupportTicket GraphQL type is defined once in support.ts (#14), which now
// also exposes the help-center fields (contextJson, refund). This module only adds the
// help-center queries/mutations below.

// Structured intake for item-scoped categories: the ids of the order's items the
// complaint is about. The mutation resolves each to its lineTotal for the refund.
const HelpItemSelectionInput = builder.inputType("HelpItemSelectionInput", {
  fields: (t) => ({
    orderItemId: t.string({ required: true }),
  }),
});

builder.queryFields((t) => ({
  // Help tickets the signed-in customer has filed for a given order (newest first),
  // so the contextual help page can render their status + resolution.
  ticketsForOrder: t.prismaField({
    type: ["SupportTicket"],
    authScopes: { loggedIn: true },
    args: { orderId: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const order = await prisma.order.findUnique({ where: { id: args.orderId } });
      if (!order || order.customerId !== ctx.userId) return [];
      return prisma.supportTicket.findMany({
        ...query,
        where: { orderId: args.orderId, customerId: ctx.userId! },
        orderBy: { createdAt: "desc" },
      });
    },
  }),
}));

builder.mutationFields((t) => ({
  // File an order-contextual help ticket. For item categories (missing/wrong), the
  // selected order items are attached and a pending Refund is opened for their
  // combined lineTotal (destination follows the order's payment mode). Quality and
  // the non-item categories just file a ticket for support to triage.
  createHelpTicket: t.prismaField({
    type: "SupportTicket",
    authScopes: { loggedIn: true },
    args: {
      orderId: t.arg.string({ required: true }),
      category: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
      items: t.arg({ type: [HelpItemSelectionInput], required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      const cat = helpCategory(args.category);
      if (!cat)
        throw new GraphQLError("Please choose a valid help topic.", {
          extensions: { code: "validation_error" },
        });

      const order = await prisma.order.findUnique({
        where: { id: args.orderId },
        include: { items: true },
      });
      if (!order || order.customerId !== ctx.userId) {
        throw new GraphQLError("We couldn't find that order.", {
          extensions: { code: "not_found" },
        });
      }

      // Resolve any selected items against the order (ignore ids that aren't on it).
      const selectedIds = new Set((args.items ?? []).map((i) => i.orderItemId));
      const selectedItems = order.items.filter((i) => selectedIds.has(i.id));

      if (cat.needsItems && selectedItems.length === 0) {
        throw new GraphQLError("Please select at least one item for this issue.", {
          extensions: { code: "validation_error" },
        });
      }

      const note = args.note?.trim() || null;
      const itemNames = selectedItems.map((i) => {
        const snap = i.menuSnapshotJson as { name?: string } | null;
        return snap?.name ?? "Item";
      });
      const subject = `${cat.label} — order ${order.code}`;
      const bodyParts: string[] = [cat.blurb];
      if (itemNames.length > 0) bodyParts.push(`Items: ${itemNames.join(", ")}`);
      if (note) bodyParts.push(note);
      const body = bodyParts.join("\n");

      const contextJson =
        selectedItems.length > 0
          ? {
              items: selectedItems.map((i) => ({
                orderItemId: i.id,
                name: (i.menuSnapshotJson as { name?: string } | null)?.name ?? "Item",
                qty: i.qty,
                lineTotalMinor: i.lineTotalMinor,
              })),
            }
          : null;

      // Item categories flagged autoRefund open a pending refund for the workbench —
      // but only once the order was actually delivered (missing/wrong items can't
      // apply to an order that never arrived, and a non-delivered order has no cash
      // collected / delivery to reverse). Otherwise we file a ticket-only complaint
      // for support to triage. Mirrors the delivered-only gate used for ratings.
      const refundAmount = selectedItems.reduce((sum, i) => sum + i.lineTotalMinor, 0);
      const openRefund = cat.autoRefund && refundAmount > 0 && order.status === "delivered";

      return prisma.$transaction(async (tx) => {
        let refundId: string | null = null;
        if (openRefund) {
          // Idempotency / over-refund guard: never open a second refund while an
          // earlier one for this order is still pending or already approved. The
          // approve path processes each Refund independently, so without this a
          // customer could resubmit the same items and be refunded twice.
          const existing = await tx.refund.findFirst({
            where: {
              orderId: order.id,
              status: { in: ["refund_pending", "refunded"] },
            },
            select: { id: true },
          });
          if (!existing) {
            const refund = await tx.refund.create({
              data: {
                orderId: order.id,
                status: "refund_pending",
                amountMinor: refundAmount,
                // COD has no card to reverse, so refund to wallet; card back to card.
                destination: order.paymentMode === "cod" ? "wallet" : "card",
                reason: `${cat.label} (help ticket): ${itemNames.join(", ")}`,
              },
            });
            refundId = refund.id;
          }
        }
        return tx.supportTicket.create({
          ...query,
          data: {
            customerId: ctx.userId!,
            orderId: order.id,
            category: cat.value,
            subject,
            body,
            // Json? column: pass a real object when we have context, else DbNull so
            // Prisma writes SQL NULL (JS `null` is rejected/ambiguous for Json fields).
            contextJson: contextJson ?? Prisma.DbNull,
            refundId,
          },
        });
      });
    },
  }),
}));

// Re-export for any tooling that wants the canonical category list from the API.
export { HELP_CATEGORIES };
