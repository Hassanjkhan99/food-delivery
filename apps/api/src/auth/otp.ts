// Dev-mode phone OTP: codes are hashed at rest, logged to the console instead of SMS,
// and returned in the mutation response outside production.
import { createHash, randomInt } from "node:crypto";
import { prisma } from "@fd/db";
import { OTP_MAX_ATTEMPTS, OTP_RATE_LIMIT_PER_HOUR, OTP_TTL_SECONDS } from "@fd/shared";
import { GraphQLError } from "graphql";
import { z } from "zod";
import { env } from "../env.js";
import { logger } from "../logger.js";

export const phoneSchema = z
  .string()
  .regex(/^\+92\d{10}$/, "Phone must be in +92XXXXXXXXXX format");

const hash = (code: string) => createHash("sha256").update(code).digest("hex");

export async function requestOtp(rawPhone: string): Promise<{ devCode: string | null }> {
  const phone = phoneSchema.parse(rawPhone);

  const recent = await prisma.otpCode.count({
    where: { phone, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } },
  });
  if (recent >= OTP_RATE_LIMIT_PER_HOUR) {
    throw new GraphQLError(
      "You've requested too many codes for this number. Please try again later.",
      {
        extensions: { code: "otp_rate_limited" },
      },
    );
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.otpCode.create({
    data: {
      phone,
      codeHash: hash(code),
      expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1_000),
    },
  });

  // Dev SMS: the console IS the delivery channel.
  logger.info(`[OTP] ${phone} -> ${code}`);
  console.log(`[OTP] ${phone} -> ${code}`);

  return { devCode: env.isProduction ? null : code };
}

export async function verifyOtp(rawPhone: string, code: string): Promise<{ userId: string }> {
  const phone = phoneSchema.parse(rawPhone);

  const otp = await prisma.otpCode.findFirst({
    where: { phone, consumedAt: null, expiresAt: { gte: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp)
    throw new GraphQLError("This code has expired. Please request a new one.", {
      extensions: { code: "otp_expired" },
    });
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    throw new GraphQLError("Too many incorrect attempts. Please request a new code.", {
      extensions: { code: "otp_too_many_attempts" },
    });
  }

  if (otp.codeHash !== hash(code)) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new GraphQLError("That code isn't correct. Please check it and try again.", {
      extensions: { code: "otp_incorrect" },
    });
  }

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

  // First login creates the user with the customer role.
  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone, roles: { create: { role: "customer" } } },
  });

  return { userId: user.id };
}
