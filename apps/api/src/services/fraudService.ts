// Fraud & abuse controls (#25): pickup PIN, order velocity, cash-variance auto-disable,
// GPS-anomaly (teleport/mock-location) detection. Additive to the existing primitives —
// COD mismatch still opens a cash_mismatch SupportTicket in rider.ts; this layer records
// the signed variance, keeps a rolling per-rider total, and disables COD when abusive.
import { randomInt } from "node:crypto";
import { prisma } from "@fd/db";
import {
  CASH_VARIANCE_DISABLE_THRESHOLD_MINOR,
  CASH_VARIANCE_WINDOW_DAYS,
  GPS_ANOMALY_MAX_SPEED_KMH,
  ORDER_VELOCITY_LIMIT,
  ORDER_VELOCITY_WINDOW_MINUTES,
  PICKUP_PIN_LENGTH,
  RIDER_LOCATION_STALE_SECONDS,
  haversineMeters,
} from "@fd/shared";
import { GraphQLError } from "graphql";
import { logger } from "../logger.js";

/** A fresh numeric pickup PIN (zero-padded, PICKUP_PIN_LENGTH digits). */
export function generatePickupPin(): string {
  const max = 10 ** PICKUP_PIN_LENGTH;
  return String(randomInt(0, max)).padStart(PICKUP_PIN_LENGTH, "0");
}

/**
 * Throw if the customer has placed too many orders in the rolling velocity window.
 * Idempotency already collapses accidental double-taps; this catches sustained scripted
 * spam / cost-abuse (OTP + notification sends, promo farming) that idempotency can't.
 */
export async function assertOrderVelocity(customerId: string): Promise<void> {
  const since = new Date(Date.now() - ORDER_VELOCITY_WINDOW_MINUTES * 60_000);
  const recent = await prisma.order.count({
    where: { customerId, placedAt: { gte: since } },
  });
  if (recent >= ORDER_VELOCITY_LIMIT) {
    throw new GraphQLError(
      "You've placed a lot of orders in a short time. Please try again later.",
      { extensions: { code: "order_velocity_exceeded" } },
    );
  }
}

/**
 * Record a COD drop's cash variance and, if the rolling window total crosses the
 * threshold, auto-disable COD for the rider and nudge their trust score down. Returns
 * whether COD was disabled by this call. Best-effort: never throws into the delivery flow.
 */
export async function recordCashVariance(args: {
  riderId: string;
  orderId: string;
  expectedMinor: number;
  collectedMinor: number;
}): Promise<{ disabled: boolean }> {
  const { riderId, orderId, expectedMinor, collectedMinor } = args;
  const varianceMinor = collectedMinor - expectedMinor;
  if (varianceMinor === 0) return { disabled: false };

  try {
    await prisma.riderCashVariance.create({
      data: { riderId, orderId, expectedMinor, collectedMinor, varianceMinor },
    });

    const since = new Date(Date.now() - CASH_VARIANCE_WINDOW_DAYS * 24 * 60 * 60_000);
    const rows = await prisma.riderCashVariance.findMany({
      where: { riderId, createdAt: { gte: since } },
      select: { varianceMinor: true },
    });
    const rollingAbs = rows.reduce((s, r) => s + Math.abs(r.varianceMinor), 0);

    if (rollingAbs >= CASH_VARIANCE_DISABLE_THRESHOLD_MINOR) {
      const rider = await prisma.rider.findUnique({ where: { id: riderId } });
      if (rider && !rider.codDisabled) {
        await prisma.rider.update({
          where: { id: riderId },
          data: { codDisabled: true, trustScore: Math.max(0, rider.trustScore - 25) },
        });
        await prisma.auditLog.create({
          data: {
            actorRole: "system",
            action: "rider.cod_disabled.cash_variance",
            subjectType: "Rider",
            subjectId: riderId,
            afterJson: {
              rollingAbsVarianceMinor: rollingAbs,
              windowDays: CASH_VARIANCE_WINDOW_DAYS,
            },
          },
        });
        logger.warn({ riderId, rollingAbs }, "rider COD auto-disabled on cash variance");
        return { disabled: true };
      }
    }
  } catch (e) {
    logger.error({ err: e, riderId, orderId }, "recordCashVariance failed");
  }
  return { disabled: false };
}

/**
 * Record a rider location heartbeat and flag a GPS anomaly when the implied speed between
 * the previous and current fix exceeds the max. Stale previous fixes (rider was offline /
 * app backgrounded) are ignored so a legitimate gap doesn't read as a teleport. Returns
 * the anomaly flag (if any). Never throws — the heartbeat itself must always succeed.
 */
export async function recordRiderLocation(args: {
  riderId: string;
  lat: number;
  lng: number;
  taskId?: string | null;
}): Promise<{ anomaly: boolean; speedKmh?: number }> {
  const { riderId, lat, lng, taskId } = args;
  const now = new Date();

  const prev = await prisma.riderAvailability.findUnique({ where: { riderId } });

  let anomaly = false;
  let speedKmh: number | undefined;
  if (prev?.lat != null && prev.lng != null && prev.lastLocationAt != null) {
    const elapsedSec = (now.getTime() - prev.lastLocationAt.getTime()) / 1_000;
    // Only compare against a recent, positive-elapsed previous fix.
    if (elapsedSec > 0 && elapsedSec <= RIDER_LOCATION_STALE_SECONDS) {
      const distanceM = haversineMeters(Number(prev.lat), Number(prev.lng), lat, lng);
      speedKmh = Math.round((distanceM / elapsedSec) * 3.6);
      if (speedKmh > GPS_ANOMALY_MAX_SPEED_KMH) {
        anomaly = true;
        try {
          await prisma.gpsAnomaly.create({
            data: {
              riderId,
              taskId: taskId ?? null,
              fromLat: prev.lat,
              fromLng: prev.lng,
              toLat: lat,
              toLng: lng,
              distanceM,
              elapsedSec: Math.round(elapsedSec),
              speedKmh,
            },
          });
          const rider = await prisma.rider.findUnique({ where: { id: riderId } });
          if (rider) {
            await prisma.rider.update({
              where: { id: riderId },
              data: { trustScore: Math.max(0, rider.trustScore - 5) },
            });
          }
          logger.warn({ riderId, speedKmh, distanceM }, "GPS anomaly flagged");
        } catch (e) {
          logger.error({ err: e, riderId }, "recordRiderLocation anomaly write failed");
        }
      }
    }
  }

  await prisma.riderAvailability.upsert({
    where: { riderId },
    update: { lat, lng, lastLocationAt: now },
    create: { riderId, lat, lng, lastLocationAt: now, isOnline: true },
  });

  return { anomaly, speedKmh };
}
