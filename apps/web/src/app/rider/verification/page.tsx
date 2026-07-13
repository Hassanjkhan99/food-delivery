"use client";

// Rider verification & trust. Surfaces verification status, trust score, missing
// onboarding requirements, and lets the rider upload docs + accept training/agreement.
import { useState } from "react";
import { useClient, useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { uploadFile } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const VerificationQuery = graphql(`
  query RiderVerification {
    myRiderProfile {
      riderId
      riderType
      verificationStatus
      trustScore
      sharedModeEnabled
      trainingCompleted
      agreementAccepted
      rejectionReason
      missingRequirements
    }
  }
`);

const SubmitDocMutation = graphql(`
  mutation SubmitRiderDoc($kind: String!, $assetId: String!) {
    submitRiderDoc(kind: $kind, assetId: $assetId) {
      id
      kind
    }
  }
`);

const UpdateOnboardingMutation = graphql(`
  mutation UpdateRiderOnboarding(
    $vehicleType: String
    $vehiclePlate: String
    $trainingCompleted: Boolean
    $agreementAccepted: Boolean
  ) {
    updateRiderOnboarding(
      vehicleType: $vehicleType
      vehiclePlate: $vehiclePlate
      trainingCompleted: $trainingCompleted
      agreementAccepted: $agreementAccepted
    ) {
      id
    }
  }
`);

const DOC_KINDS: { value: string; label: string }[] = [
  { value: "cnic_front", label: "CNIC (front)" },
  { value: "cnic_back", label: "CNIC (back)" },
  { value: "photo", label: "Rider photo" },
  { value: "vehicle_registration", label: "Vehicle registration" },
  { value: "license", label: "Driving license" },
];

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "verified") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}

export default function RiderVerificationPage() {
  const [{ data, fetching }, refetch] = useQuery({
    query: VerificationQuery,
    requestPolicy: "cache-and-network",
  });
  const client = useClient();
  const [, submitDoc] = useMutation(SubmitDocMutation);
  const [, updateOnboarding] = useMutation(UpdateOnboardingMutation);

  const [uploadingKind, setUploadingKind] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const profile = data?.myRiderProfile;
  if (!profile) {
    return fetching ? (
      <Skeleton className="h-40 rounded-2xl" />
    ) : (
      <p className="text-kd-fg-muted">No rider profile for this account.</p>
    );
  }

  async function onUpload(kind: string, file: File | undefined) {
    if (!file) return;
    setUploadingKind(kind);
    setError(null);
    try {
      // Verification docs are sensitive — upload as a private (signed-read) asset (#119).
      const { assetId } = await uploadFile(client, file, "image", true);
      const res = await submitDoc({ kind, assetId });
      if (res.error) throw new Error(res.error.graphQLErrors[0]?.message ?? "Submit failed");
      refetch({ requestPolicy: "network-only" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingKind(null);
    }
  }

  async function saveOnboarding(patch: {
    vehicleType?: string;
    vehiclePlate?: string;
    trainingCompleted?: boolean;
    agreementAccepted?: boolean;
  }) {
    setBusy(true);
    setError(null);
    const res = await updateOnboarding(patch);
    setBusy(false);
    if (res.error) {
      setError(res.error.graphQLErrors[0]?.message ?? "Save failed");
      return;
    }
    refetch({ requestPolicy: "network-only" });
  }

  const missing = profile.missingRequirements ?? [];

  return (
    <main className="space-y-4">
      <div className="rounded-2xl border border-kd-border bg-kd-surface p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Verification</h1>
          <Badge variant={statusVariant(profile.verificationStatus)}>
            {profile.verificationStatus}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-kd-fg-muted">{profile.riderType} rider</p>

        <div className="mt-3 flex items-center gap-4">
          <div>
            <p className="text-xs text-kd-fg-muted">Trust score</p>
            <p className="text-2xl font-bold">{profile.trustScore}</p>
          </div>
          <Badge variant={profile.sharedModeEnabled ? "default" : "outline"}>
            {profile.sharedModeEnabled ? "Shared mode on" : "Shared mode off"}
          </Badge>
        </div>

        {profile.verificationStatus === "rejected" && profile.rejectionReason && (
          <p className="mt-3 rounded-lg bg-kd-danger-soft px-3 py-2 text-sm text-kd-danger">
            Rejected: {profile.rejectionReason}
          </p>
        )}

        {missing.length > 0 && (
          <div className="mt-3 rounded-lg bg-kd-surface-muted px-3 py-2 text-sm">
            <p className="font-medium">Still needed to verify:</p>
            <ul className="mt-1 list-inside list-disc text-kd-fg-muted">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-lg bg-kd-danger-soft px-3 py-2 text-sm text-kd-danger">{error}</p>
      )}

      <section className="rounded-2xl border border-kd-border bg-kd-surface p-4">
        <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Documents</h2>
        <div className="space-y-3">
          {DOC_KINDS.map((d) => (
            <div key={d.value} className="flex items-center justify-between gap-2">
              <Label className="text-sm">{d.label}</Label>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onUpload(d.value, e.target.files?.[0])}
                />
                <span className="rounded-lg border border-kd-border px-3 py-1 text-xs">
                  {uploadingKind === d.value ? "Uploading…" : "Upload"}
                </span>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-kd-border bg-kd-surface p-4">
        <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Vehicle</h2>
        <div className="space-y-3">
          <div>
            <Label>Vehicle type</Label>
            <Input
              value={vehicleType}
              onChange={(e) => setVehicleType(e.target.value)}
              placeholder="e.g. motorcycle"
              className="mt-1"
            />
          </div>
          <div>
            <Label>Vehicle plate</Label>
            <Input
              value={vehiclePlate}
              onChange={(e) => setVehiclePlate(e.target.value)}
              placeholder="e.g. LEA-1234"
              className="mt-1"
            />
          </div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => saveOnboarding({ vehicleType, vehiclePlate })}
          >
            Save vehicle
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-kd-border bg-kd-surface p-4">
        <h2 className="mb-2 text-sm font-bold uppercase text-kd-fg-muted">Onboarding</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Training completion</span>
            {profile.trainingCompleted ? (
              <Badge>Done</Badge>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => saveOnboarding({ trainingCompleted: true })}
              >
                Mark complete
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span>Agreement acceptance</span>
            {profile.agreementAccepted ? (
              <Badge>Accepted</Badge>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => saveOnboarding({ agreementAccepted: true })}
              >
                Accept
              </Button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
