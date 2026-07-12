// Foodpanda-shaped payment flow, fully simulated. Deterministic test behaviors:
//   4000000000000002  -> tokenizes fine, every charge is DECLINED
//   any other 13-19 digit number -> charges succeed instantly
import { createHash, randomUUID } from "node:crypto";
import { GraphQLError } from "graphql";
import type { CardInput, PaymentProvider } from "./provider.js";

const DECLINE_CARD_FINGERPRINT = fingerprint("4000000000000002");

function fingerprint(pan: string): string {
  return createHash("sha256").update(pan).digest("hex").slice(0, 16);
}

function detectBrand(pan: string): string {
  if (pan.startsWith("4")) return "visa";
  if (pan.startsWith("5")) return "mastercard";
  if (pan.startsWith("3")) return "amex";
  return "card";
}

export const mockProvider: PaymentProvider = {
  async tokenize(card: CardInput) {
    const pan = card.number.replace(/\s/g, "");
    if (!/^\d{13,19}$/.test(pan))
      throw new GraphQLError("Please enter a valid card number.", {
        extensions: { code: "validation_error" },
      });
    const now = new Date();
    if (
      card.expYear < now.getFullYear() ||
      (card.expYear === now.getFullYear() && card.expMonth < now.getMonth() + 1)
    ) {
      throw new GraphQLError("This card has expired. Please use a different card.", {
        extensions: { code: "validation_error" },
      });
    }
    if (!/^\d{3,4}$/.test(card.cvc))
      throw new GraphQLError("Please enter a valid security code (CVC).", {
        extensions: { code: "validation_error" },
      });

    // The PAN survives only inside this call: the token embeds a one-way fingerprint
    // so the decline test-card stays recognizable, never the number itself.
    return {
      token: `mocktok_${fingerprint(pan)}_${randomUUID().slice(0, 8)}`,
      brand: detectBrand(pan),
      last4: pan.slice(-4),
      expMonth: card.expMonth,
      expYear: card.expYear,
    };
  },

  async charge({ token, amountMinor, reference }) {
    if (token.includes(DECLINE_CARD_FINGERPRINT)) {
      return { ok: false, declineReason: "Card declined by issuer (mock)" };
    }
    if (amountMinor <= 0) return { ok: false, declineReason: "Invalid amount" };
    return { ok: true, providerRef: `mockch_${reference}_${randomUUID().slice(0, 8)}` };
  },

  async refund({ reference }) {
    return { ok: true, providerRef: `mockrf_${reference}_${randomUUID().slice(0, 8)}` };
  },
};
