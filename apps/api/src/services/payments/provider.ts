// PaymentProvider: the ONLY seam that changes when a real PSP (Safepay/PayFast)
// replaces the mock. Checkout, ledger, and refund flows never touch provider details.
//
// PCI note: with a real PSP the card form talks to the PSP's SDK directly and the
// API only ever sees the token — tokenize() then disappears from this interface's
// server-side usage. The mock accepts the PAN transiently (never persisted) so the
// full UX can be built without an external service.

export type CardInput = {
  number: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  holderName?: string;
};

export type TokenizedCard = {
  token: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export type ChargeResult = { ok: true; providerRef: string } | { ok: false; declineReason: string };

export type RefundResult = { ok: true; providerRef: string };

export interface PaymentProvider {
  tokenize(card: CardInput): Promise<TokenizedCard>;
  charge(args: { token: string; amountMinor: number; reference: string }): Promise<ChargeResult>;
  refund(args: {
    chargeRef: string;
    amountMinor: number;
    reference: string;
  }): Promise<RefundResult>;
}
