"use client";

// Active job lifecycle: arrived at pickup -> picked up -> delivered (with COD capture).
import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useClient, useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { uploadFile } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const JobQuery = graphql(`
  query RiderJob {
    myJobs {
      id
      status
      codAmountMinor
      order {
        id
        code
        contactPhone
        customerNote
        addressSnapshotJson
        branch {
          addressText
          restaurant {
            name
          }
        }
        items {
          id
          qty
          menuSnapshotJson
        }
      }
    }
  }
`);

const ArrivedMutation = graphql(`
  mutation Arrived($taskId: String!) {
    riderArrivedAtPickup(taskId: $taskId) {
      id
      status
    }
  }
`);
const PickedUpMutation = graphql(`
  mutation PickedUp($taskId: String!) {
    riderPickedUp(taskId: $taskId) {
      id
      status
    }
  }
`);
const DeliveredMutation = graphql(`
  mutation Delivered($taskId: String!, $cod: Int!, $podMediaId: String) {
    riderDelivered(taskId: $taskId, codCollectedMinor: $cod, podMediaId: $podMediaId) {
      id
      status
    }
  }
`);
const IncidentMutation = graphql(`
  mutation Incident($taskId: String!, $note: String!) {
    reportIncident(taskId: $taskId, note: $note)
  }
`);

export default function RiderJobPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const router = useRouter();
  const client = useClient();
  const [{ data, fetching }, refetch] = useQuery({
    query: JobQuery,
    requestPolicy: "cache-and-network",
  });
  const [, arrived] = useMutation(ArrivedMutation);
  const [, pickedUp] = useMutation(PickedUpMutation);
  const [deliveredState, delivered] = useMutation(DeliveredMutation);
  const [, incident] = useMutation(IncidentMutation);
  const [codInput, setCodInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Proof-of-delivery photo: optional but prominent. Upload via the shared
  // presign -> PUT -> finalize flow, then thread the finalized assetId into riderDelivered.
  const podFileRef = useRef<HTMLInputElement>(null);
  const [podAssetId, setPodAssetId] = useState<string | null>(null);
  const [podPreviewUrl, setPodPreviewUrl] = useState<string | null>(null);
  const [podUploading, setPodUploading] = useState(false);

  async function handlePodUpload(file: File) {
    setError(null);
    setPodUploading(true);
    try {
      const { assetId, url } = await uploadFile(client, file, "image");
      setPodAssetId(assetId);
      setPodPreviewUrl(url || null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPodUploading(false);
    }
  }

  const job = data?.myJobs.find((j) => j.id === taskId);
  if (!job) return fetching ? <Skeleton className="h-64 rounded-2xl" /> : <p>Job not found.</p>;

  const addr = job.order.addressSnapshotJson as { text?: string };
  const refresh = () => refetch({ requestPolicy: "network-only" });

  return (
    <main className="space-y-4">
      <div className="rounded-2xl border border-kd-border bg-kd-surface p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">{job.order.code}</h1>
          <Badge>{job.status.replace(/_/g, " ")}</Badge>
        </div>
        <div className="mt-3 space-y-2 text-sm">
          <p>
            <span className="font-medium">Pickup:</span> {job.order.branch.restaurant.name},{" "}
            {job.order.branch.addressText}
          </p>
          <p>
            <span className="font-medium">Drop:</span> {addr?.text ?? "—"}
          </p>
          <p>
            <span className="font-medium">Customer:</span>{" "}
            <a href={`tel:${job.order.contactPhone}`} className="underline">
              {job.order.contactPhone}
            </a>
          </p>
          {job.order.customerNote && (
            <p className="italic text-kd-fg-muted">“{job.order.customerNote}”</p>
          )}
        </div>
        <ul className="mt-3 rounded-lg bg-kd-surface-muted p-3 text-sm">
          {job.order.items.map((i) => {
            const snap = i.menuSnapshotJson as { name?: string };
            return (
              <li key={i.id}>
                {i.qty} × {snap.name}
              </li>
            );
          })}
        </ul>
        {job.codAmountMinor > 0 && (
          <p className="mt-3 rounded-lg bg-kd-warning-soft p-3 text-center font-semibold text-kd-warning">
            Collect {formatRs(job.codAmountMinor)} in cash
          </p>
        )}
      </div>

      {error && <p className="text-sm text-kd-danger">{error}</p>}

      {job.status === "assigned" && (
        <Button
          className="w-full"
          size="lg"
          onClick={async () => {
            await arrived({ taskId });
            refresh();
          }}
        >
          Arrived at pickup
        </Button>
      )}
      {["assigned", "arrived_pickup"].includes(job.status) && (
        <Button
          className="w-full"
          size="lg"
          variant={job.status === "assigned" ? "outline" : "default"}
          onClick={async () => {
            const r = await pickedUp({ taskId });
            if (r.error) setError(r.error.graphQLErrors[0]?.message ?? "Failed");
            refresh();
          }}
        >
          Picked up — heading out
        </Button>
      )}
      {job.status === "picked_up" && (
        <div className="space-y-4 rounded-2xl border border-kd-border bg-kd-surface p-4">
          {job.codAmountMinor > 0 && (
            <div>
              <label className="text-sm font-medium">Cash collected (Rs)</label>
              <Input
                inputMode="numeric"
                value={codInput}
                onChange={(e) => setCodInput(e.target.value)}
                placeholder={String(job.codAmountMinor / 100)}
                className="mt-1"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Proof-of-delivery photo</label>
              <Badge variant="secondary">Optional</Badge>
            </div>
            <p className="mt-1 text-kd-caption text-kd-fg-muted">
              Snap the handoff or the doorstep so there is a record of delivery.
            </p>
            <input
              ref={podFileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handlePodUpload(file);
                e.target.value = "";
              }}
            />
            {podPreviewUrl ? (
              <div className="mt-2 space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={podPreviewUrl}
                  alt="Proof of delivery"
                  className="h-40 w-full rounded-lg border border-kd-border object-cover"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={podUploading}
                    onClick={() => podFileRef.current?.click()}
                  >
                    Retake
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1"
                    disabled={podUploading}
                    onClick={() => {
                      setPodAssetId(null);
                      setPodPreviewUrl(null);
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="mt-2 w-full"
                disabled={podUploading}
                onClick={() => podFileRef.current?.click()}
              >
                {podUploading ? "Uploading…" : "Add delivery photo"}
              </Button>
            )}
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={
              deliveredState.fetching ||
              podUploading ||
              (job.codAmountMinor > 0 && !codInput)
            }
            onClick={async () => {
              const cod = job.codAmountMinor > 0 ? Math.round(Number(codInput) * 100) : 0;
              const r = await delivered({ taskId, cod, podMediaId: podAssetId });
              if (r.error) {
                setError(r.error.graphQLErrors[0]?.message ?? "Failed");
                return;
              }
              router.push("/rider");
            }}
          >
            Mark delivered
          </Button>
        </div>
      )}

      <Button
        variant="outline"
        className="w-full"
        onClick={async () => {
          const note = prompt("Describe the problem (customer unreachable, accident, …):");
          if (note?.trim()) {
            await incident({ taskId, note });
            alert("Incident reported — support will follow up.");
          }
        }}
      >
        Report a problem
      </Button>
    </main>
  );
}
