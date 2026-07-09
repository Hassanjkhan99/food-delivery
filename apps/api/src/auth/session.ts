// Session token = HS256 JWS carrying {sid, uid, roles}. The DB Session row is the
// source of truth (revocable); the JWS lets Next.js middleware gate routes without a DB hit.
import { SignJWT, jwtVerify } from "jose";
import { SESSION_TTL_DAYS } from "@fd/shared";
import { env } from "../env.js";

export type SessionRoleClaim = { role: string; restaurantId?: string | null };
export type SessionClaims = { sid: string; uid: string; roles: SessionRoleClaim[] };

const secret = () => new TextEncoder().encode(env.sessionSecret);

export async function signSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT(claims as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sid !== "string" || typeof payload.uid !== "string") return null;
    return {
      sid: payload.sid,
      uid: payload.uid,
      roles: Array.isArray(payload.roles) ? (payload.roles as SessionRoleClaim[]) : [],
    };
  } catch {
    return null;
  }
}
