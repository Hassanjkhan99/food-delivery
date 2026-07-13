"use client";

// Restaurant KYC / verification (#152). Owner submits identity + bank details (CNIC scan
// via MediaAsset) and sees the review status; admin approves/rejects.
import { useState } from "react";
import { useQuery, useMutation, useClient } from "urql";
import { graphql } from "@/graphql/generated";
import { useConsole } from "../useConsole";
import { uploadFile } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const KycQuery = graphql(`
  query RestaurantKyc($restaurantId: String!) {
    restaurantKyc(restaurantId: $restaurantId) {
      id
      status
      ownerName
      ownerCnic
      bankAccountName
      bankIban
      cnicAssetId
      rejectionReason
    }
  }
`);

const SubmitKycMutation = graphql(`
  mutation SubmitKyc(
    $restaurantId: String!
    $ownerName: String!
    $ownerCnic: String!
    $bankAccountName: String
    $bankIban: String
    $cnicAssetId: String
  ) {
    submitKyc(
      restaurantId: $restaurantId
      ownerName: $ownerName
      ownerCnic: $ownerCnic
      bankAccountName: $bankAccountName
      bankIban: $bankIban
      cnicAssetId: $cnicAssetId
    ) {
      id
      status
    }
  }
`);

type Kyc = {
  status: string;
  ownerName: string;
  ownerCnic: string;
  bankAccountName?: string | null;
  bankIban?: string | null;
  cnicAssetId?: string | null;
  rejectionReason?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  submitted: "Under review",
  approved: "Verified",
  rejected: "Needs changes",
};

function KycForm({
  restaurantId,
  initial,
  onSaved,
}: {
  restaurantId: string;
  initial: Kyc | null;
  onSaved: () => void;
}) {
  const client = useClient();
  const [, submit] = useMutation(SubmitKycMutation);
  const [ownerName, setOwnerName] = useState(initial?.ownerName ?? "");
  const [ownerCnic, setOwnerCnic] = useState(initial?.ownerCnic ?? "");
  const [bankAccountName, setBankAccountName] = useState(initial?.bankAccountName ?? "");
  const [bankIban, setBankIban] = useState(initial?.bankIban ?? "");
  const [cnicAssetId, setCnicAssetId] = useState<string | null>(initial?.cnicAssetId ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCnicUpload(file: File) {
    setError(null);
    try {
      const { assetId } = await uploadFile(client, file, "image");
      setCnicAssetId(assetId);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onSubmit() {
    setBusy(true);
    setError(null);
    const r = await submit({
      restaurantId,
      ownerName,
      ownerCnic,
      bankAccountName: bankAccountName.trim() || undefined,
      bankIban: bankIban.trim() || undefined,
      cnicAssetId: cnicAssetId ?? undefined,
    });
    setBusy(false);
    if (r.error) setError(r.error.graphQLErrors[0]?.message ?? "Couldn't submit for review.");
    else onSaved();
  }

  const approved = initial?.status === "approved";

  return (
    <div className="space-y-3 rounded-xl border border-kd-border bg-kd-surface p-4 text-sm">
      <div>
        <Label htmlFor="ownerName">Owner full name</Label>
        <Input
          id="ownerName"
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          disabled={approved}
        />
      </div>
      <div>
        <Label htmlFor="ownerCnic">Owner CNIC</Label>
        <Input
          id="ownerCnic"
          value={ownerCnic}
          onChange={(e) => setOwnerCnic(e.target.value)}
          placeholder="42101-1234567-1"
          disabled={approved}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="bankAccountName">Bank account name</Label>
          <Input
            id="bankAccountName"
            value={bankAccountName}
            onChange={(e) => setBankAccountName(e.target.value)}
            disabled={approved}
          />
        </div>
        <div>
          <Label htmlFor="bankIban">Bank IBAN</Label>
          <Input
            id="bankIban"
            value={bankIban}
            onChange={(e) => setBankIban(e.target.value)}
            placeholder="PK..."
            disabled={approved}
          />
        </div>
      </div>
      {!approved && (
        <div>
          <Label>CNIC scan</Label>
          <div className="mt-1 flex items-center gap-3">
            <label className="cursor-pointer rounded-lg border border-kd-border px-3 py-1.5 text-xs font-medium hover:bg-kd-surface-muted">
              {cnicAssetId ? "Replace scan" : "Upload scan"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onCnicUpload(e.target.files[0])}
              />
            </label>
            {cnicAssetId && <span className="text-xs text-kd-success">Attached.</span>}
          </div>
        </div>
      )}
      {error && <p className="text-sm text-kd-danger">{error}</p>}
      {!approved && (
        <Button size="sm" disabled={busy || !ownerName || !ownerCnic} onClick={onSubmit}>
          {busy ? "Submitting…" : initial ? "Resubmit for review" : "Submit for review"}
        </Button>
      )}
    </div>
  );
}

export default function VerificationPage() {
  const { restaurant, isOwner } = useConsole();
  const restaurantId = restaurant?.id ?? "";
  const [{ data, fetching }, refetch] = useQuery({
    query: KycQuery,
    variables: { restaurantId },
    pause: !restaurantId,
    requestPolicy: "cache-and-network",
  });

  if (!restaurant) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;
  if (!isOwner)
    return <p className="text-kd-fg-muted">Only the restaurant owner can manage verification.</p>;
  if (fetching && !data) return <p className="text-kd-fg-muted">Loading…</p>;

  const kyc = (data?.restaurantKyc ?? null) as Kyc | null;

  return (
    <main className="max-w-xl">
      <div className="mb-3 flex items-center gap-3">
        <h1 className="text-xl font-bold">Verification</h1>
        {kyc && (
          <Badge variant={kyc.status === "approved" ? "default" : "secondary"}>
            {STATUS_LABEL[kyc.status] ?? kyc.status}
          </Badge>
        )}
      </div>
      <p className="mb-4 text-sm text-kd-fg-muted">
        Submit your identity and bank details so we can verify your restaurant and pay you out. Your
        restaurant can&apos;t go live until KYC is approved.
      </p>

      {kyc?.status === "rejected" && kyc.rejectionReason && (
        <p className="mb-4 rounded-lg bg-kd-danger-soft px-3 py-2 text-sm text-kd-danger">
          Rejected: {kyc.rejectionReason}. Please update and resubmit.
        </p>
      )}
      {kyc?.status === "approved" && (
        <p className="mb-4 rounded-lg bg-kd-success-soft px-3 py-2 text-sm text-kd-success">
          Your restaurant is verified.
        </p>
      )}

      <KycForm
        key={`${kyc?.status ?? "new"}`}
        restaurantId={restaurantId}
        initial={kyc}
        onSaved={() => refetch({ requestPolicy: "network-only" })}
      />
    </main>
  );
}
