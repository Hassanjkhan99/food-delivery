// Rider onboarding-requirement checks. Requirements differ by rider type (kickoff):
//   • restaurant rider   — phone required (always true post-invite); CNIC recommended.
//   • shared/independent — CNIC (front+back) + photo + vehicle type + plate REQUIRED,
//                          plus training completion + agreement acceptance.
// Used by the admin verification queue to show what's missing before approval, and to
// block approving a shared/independent rider whose docs are incomplete.
import type { Rider, RiderVerificationDoc } from "@fd/db";

export type RiderForRequirements = Pick<
  Rider,
  "riderType" | "vehicleType" | "vehiclePlate" | "trainingCompleted" | "agreementAccepted"
> & { verificationDocs: Pick<RiderVerificationDoc, "kind">[] };

/**
 * Return the list of unmet onboarding requirements for a rider. Empty array => ready to
 * verify. `restaurant` riders have only soft (recommended) requirements, so this is
 * empty for them unless a hard gate is added later.
 */
export function missingRequirements(rider: RiderForRequirements): string[] {
  const missing: string[] = [];
  const hasDoc = (kind: string) => rider.verificationDocs.some((d) => d.kind === kind);

  if (rider.riderType === "shared" || rider.riderType === "independent") {
    if (!hasDoc("cnic_front")) missing.push("CNIC front");
    if (!hasDoc("cnic_back")) missing.push("CNIC back");
    if (!hasDoc("photo")) missing.push("Rider photo");
    if (!rider.vehicleType) missing.push("Vehicle type");
    if (!rider.vehiclePlate) missing.push("Vehicle plate");
    if (!rider.trainingCompleted) missing.push("Training completion");
    if (!rider.agreementAccepted) missing.push("Agreement acceptance");
  }
  return missing;
}
