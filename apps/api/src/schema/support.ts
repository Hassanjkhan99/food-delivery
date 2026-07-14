// Support domain (issue #14): agent-facing ticket queue over SupportTicket.
// List/filter/assign/resolve with resolutionCode + SLA timers, plus a read-only
// "evidence bundle" (order events + delivery events + payment + refunds) so a
// dispute — notably COD cash_mismatch — can be triaged to resolution in the UI.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { TICKET_RESOLUTION_CODES, ticketCategoryFilterValues, isRestaurantOwner } from "@fd/shared";
import { builder } from "./builder.js";

async function audit(
  actorUserId: string | null,
  action: string,
  subjectId: string,
  before: unknown,
  after: unknown,
) {
  await prisma.auditLog.create({
    data: {
      actorUserId,
      actorRole: "admin",
      action,
      subjectType: "SupportTicket",
      subjectId,
      beforeJson: before as never,
      afterJson: after as never,
    },
  });
}

// ── evidence bundle (computed, read-only) ────────────────────────────────────
type EvidenceRow = {
  id: string;
  source: string; // "order" | "delivery" | "payment" | "refund"
  label: string;
  detail: string | null;
  amountMinor: number | null;
  createdAt: Date;
};

const EvidenceRowType = builder.objectRef<EvidenceRow>("TicketEvidenceRow");
EvidenceRowType.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    source: t.exposeString("source"),
    label: t.exposeString("label"),
    detail: t.exposeString("detail", { nullable: true }),
    amountMinor: t.exposeInt("amountMinor", { nullable: true }),
    createdAt: t.field({ type: "DateTime", resolve: (r) => r.createdAt }),
  }),
});

builder.prismaObject("SupportTicket", {
  fields: (t) => ({
    id: t.exposeID("id"),
    category: t.exposeString("category"),
    subject: t.exposeString("subject"),
    body: t.exposeString("body"),
    status: t.exposeString("status"),
    resolutionCode: t.exposeString("resolutionCode", { nullable: true }),
    resolutionNote: t.exposeString("resolutionNote", { nullable: true }),
    // Restaurant's own reply to the customer (#160).
    restaurantResponse: t.exposeString("restaurantResponse", { nullable: true }),
    restaurantRespondedAt: t.field({
      type: "DateTime",
      nullable: true,
      resolve: (r) => r.restaurantRespondedAt,
    }),
    assignedToUserId: t.exposeString("assignedToUserId", { nullable: true }),
    assignedToName: t.exposeString("assignedToName", { nullable: true }),
    firstRespondedAt: t.field({
      type: "DateTime",
      nullable: true,
      resolve: (r) => r.firstRespondedAt,
    }),
    resolvedAt: t.field({ type: "DateTime", nullable: true, resolve: (r) => r.resolvedAt }),
    createdAt: t.field({ type: "DateTime", resolve: (r) => r.createdAt }),
    updatedAt: t.field({ type: "DateTime", resolve: (r) => r.updatedAt }),
    // Structured intake payload for the category (help-center #45).
    contextJson: t.field({ type: "JSON", nullable: true, resolve: (tk) => tk.contextJson }),
    order: t.relation("order", { nullable: true }),
    // Refund opened by this ticket (missing/wrong items), if any (#45).
    refund: t.relation("refund", { nullable: true }),
    customer: t.relation("customer"),
    // The dispute primitives assembled in one panel. Empty when the ticket has no order.
    evidence: t.field({
      type: [EvidenceRowType],
      resolve: async (ticket) => {
        if (!ticket.orderId) return [];
        const order = await prisma.order.findUnique({
          where: { id: ticket.orderId },
          include: {
            events: { orderBy: { createdAt: "asc" } },
            payment: true,
            refunds: { orderBy: { createdAt: "asc" } },
            deliveryTask: { include: { events: { orderBy: { createdAt: "asc" } } } },
          },
        });
        if (!order) return [];
        const rows: EvidenceRow[] = [];
        for (const e of order.events) {
          rows.push({
            id: `oe:${e.id}`,
            source: "order",
            label: `${e.fromStatus ?? "∅"} → ${e.toStatus}`,
            detail: e.reason ?? e.actorRole ?? null,
            amountMinor: null,
            createdAt: e.createdAt,
          });
        }
        for (const de of order.deliveryTask?.events ?? []) {
          rows.push({
            id: `de:${de.id}`,
            source: "delivery",
            label: de.type,
            detail: de.note ?? null,
            amountMinor: null,
            createdAt: de.createdAt,
          });
        }
        if (order.payment) {
          rows.push({
            id: `pm:${order.payment.id}`,
            source: "payment",
            label: `Payment ${order.payment.status} (${order.payment.mode})`,
            detail: order.payment.providerRef,
            amountMinor: order.payment.amountMinor,
            // Label reflects the *current* status, so anchor it to the capture
            // time when present; otherwise the row sorts before the delivery
            // event that actually captured a COD/card payment.
            createdAt: order.payment.capturedAt ?? order.payment.createdAt,
          });
        }
        for (const r of order.refunds) {
          rows.push({
            id: `rf:${r.id}`,
            source: "refund",
            label: `Refund ${r.status} → ${r.destination}`,
            detail: r.reason,
            amountMinor: r.amountMinor,
            createdAt: r.createdAt,
          });
        }
        rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return rows;
      },
    }),
  }),
});

// ── queries ──────────────────────────────────────────────────────────────────
builder.queryFields((t) => ({
  // Agent queue. Optional status/category filters; oldest-open first so the most
  // SLA-critical tickets surface at the top. SLA breach state is computed client
  // side from createdAt/firstRespondedAt/resolvedAt against the shared playbooks.
  ticketQueue: t.prismaField({
    type: ["SupportTicket"],
    authScopes: { admin: true },
    args: {
      status: t.arg.string({ required: false }),
      category: t.arg.string({ required: false }),
      take: t.arg.int({ required: false }),
    },
    resolve: (query, _root, args) =>
      prisma.supportTicket.findMany({
        ...query,
        where: {
          // No explicit status ⇒ the "All open" default: active work only, so
          // stale resolved/closed tickets don't crowd out live SLA rows.
          ...(args.status
            ? { status: args.status as never }
            : { status: { in: ["open", "in_progress"] } }),
          ...(args.category ? { category: { in: ticketCategoryFilterValues(args.category) } } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: Math.min(args.take ?? 100, 200),
      }),
  }),

  ticket: t.prismaField({
    type: "SupportTicket",
    nullable: true,
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: (query, _root, args) =>
      prisma.supportTicket.findUnique({ ...query, where: { id: args.id } }),
  }),

  // Restaurant-scoped inbox (#160): tickets tied to this restaurant's orders.
  restaurantTickets: t.prismaField({
    type: ["SupportTicket"],
    authScopes: { restaurantMember: true },
    args: { restaurantId: t.arg.string({ required: true }) },
    resolve: (query, _root, args, ctx) => {
      // #204: the restaurant support inbox is an owner-only surface (staff = Orders + Today).
      if (!isRestaurantOwner(ctx.roles, args.restaurantId) && !ctx.hasRole("admin"))
        throw new GraphQLError("Only the restaurant owner can do this.", {
          extensions: { code: "forbidden" },
        });
      return prisma.supportTicket.findMany({
        ...query,
        where: { order: { branch: { restaurantId: args.restaurantId } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    },
  }),
}));

// ── mutations ─────────────────────────────────────────────────────────────────
builder.mutationFields((t) => ({
  // Restaurant posts a reply to the customer on one of its orders' tickets (#160).
  respondToTicket: t.prismaField({
    type: "SupportTicket",
    authScopes: { restaurantMember: true },
    args: { ticketId: t.arg.string({ required: true }), body: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: args.ticketId },
        include: { order: { include: { branch: true } } },
      });
      if (!ticket?.order)
        throw new GraphQLError("We couldn't find that ticket.", {
          extensions: { code: "not_found" },
        });
      // Owner-only (#204/#205): the reply is now shown to the customer, so a non-owner staff
      // account must not be able to publish customer-facing responses via the API.
      const restaurantId = ticket.order.branch.restaurantId;
      const isOwner = ctx.roles.some(
        (r) => r.role === "restaurant_owner" && r.restaurantId === restaurantId,
      );
      if (!isOwner && !ctx.hasRole("admin"))
        throw new GraphQLError("Only the restaurant owner can reply to support tickets.", {
          extensions: { code: "forbidden" },
        });
      const body = args.body.trim();
      if (!body)
        throw new GraphQLError("Please enter a response.", {
          extensions: { code: "validation_error" },
        });
      return prisma.supportTicket.update({
        ...query,
        where: { id: args.ticketId },
        data: { restaurantResponse: body, restaurantRespondedAt: new Date() },
      });
    },
  }),

  // Take ownership. Records the agent id + a name snapshot and, if this is the
  // first touch, stamps firstRespondedAt so the first-response SLA stops.
  assignTicket: t.prismaField({
    type: "SupportTicket",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const before = await prisma.supportTicket.findUniqueOrThrow({ where: { id: args.id } });
      if (before.status === "resolved" || before.status === "closed") {
        throw new GraphQLError("This ticket is already closed.", {
          extensions: { code: "invalid_state" },
        });
      }
      const agent = ctx.userId ? await prisma.user.findUnique({ where: { id: ctx.userId } }) : null;
      const updated = await prisma.supportTicket.update({
        ...query,
        where: { id: args.id },
        data: {
          assignedToUserId: ctx.userId,
          assignedToName: agent?.name ?? agent?.phone ?? "Agent",
          status: before.status === "open" ? "in_progress" : before.status,
          firstRespondedAt: before.firstRespondedAt ?? new Date(),
        },
      });
      await audit(
        ctx.userId,
        "ticket.assign",
        args.id,
        { assignedToUserId: before.assignedToUserId, status: before.status },
        { assignedToUserId: ctx.userId, status: updated.status },
      );
      return updated;
    },
  }),

  // Resolve with a resolutionCode from the shared list. Stamps resolvedAt (stops
  // the resolution SLA) and, if unanswered, firstRespondedAt too.
  resolveTicket: t.prismaField({
    type: "SupportTicket",
    authScopes: { admin: true },
    args: {
      id: t.arg.string({ required: true }),
      resolutionCode: t.arg.string({ required: true }),
      note: t.arg.string({ required: false }),
    },
    resolve: async (query, _root, args, ctx) => {
      if (!(TICKET_RESOLUTION_CODES as readonly string[]).includes(args.resolutionCode)) {
        throw new GraphQLError("Please choose a valid resolution code.", {
          extensions: { code: "validation_error" },
        });
      }
      const before = await prisma.supportTicket.findUniqueOrThrow({ where: { id: args.id } });
      if (before.status === "resolved" || before.status === "closed") {
        throw new GraphQLError("This ticket is already closed.", {
          extensions: { code: "invalid_state" },
        });
      }
      const now = new Date();
      const updated = await prisma.supportTicket.update({
        ...query,
        where: { id: args.id },
        data: {
          status: "resolved",
          resolutionCode: args.resolutionCode,
          resolutionNote: args.note ?? null,
          resolvedAt: now,
          firstRespondedAt: before.firstRespondedAt ?? now,
        },
      });
      await audit(
        ctx.userId,
        "ticket.resolve",
        args.id,
        { status: before.status },
        { status: "resolved", resolutionCode: args.resolutionCode, note: args.note ?? null },
      );
      return updated;
    },
  }),

  // Reopen a resolved ticket back into the queue (clears resolution fields).
  reopenTicket: t.prismaField({
    type: "SupportTicket",
    authScopes: { admin: true },
    args: { id: t.arg.string({ required: true }) },
    resolve: async (query, _root, args, ctx) => {
      const before = await prisma.supportTicket.findUniqueOrThrow({ where: { id: args.id } });
      const updated = await prisma.supportTicket.update({
        ...query,
        where: { id: args.id },
        data: {
          status: "in_progress",
          resolutionCode: null,
          resolutionNote: null,
          resolvedAt: null,
        },
      });
      await audit(
        ctx.userId,
        "ticket.reopen",
        args.id,
        { status: before.status, resolutionCode: before.resolutionCode },
        { status: "in_progress" },
      );
      return updated;
    },
  }),
}));
