"use client";

// Active job lifecycle: arrived at pickup -> picked up -> delivered (with COD capture).
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
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
  mutation Delivered($taskId: String!, $cod: Int!) {
    riderDelivered(taskId: $taskId, codCollectedMinor: $cod) {
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

  const job = data?.myJobs.find((j) => j.id === taskId);
  if (!job) return fetching ? <Skeleton className="h-64 rounded-2xl" /> : <p>Job not found.</p>;

  const addr = job.order.addressSnapshotJson as { text?: string };
  const refresh = () => refetch({ requestPolicy: "network-only" });

  return (
    <main className="space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4">
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
            <p className="italic text-neutral-500">“{job.order.customerNote}”</p>
          )}
        </div>
        <ul className="mt-3 rounded-lg bg-neutral-50 p-3 text-sm">
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
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-center font-semibold text-amber-800">
            Collect {formatRs(job.codAmountMinor)} in cash
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

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
        <div className="space-y-2 rounded-2xl border border-neutral-200 bg-white p-4">
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
          <Button
            className="w-full"
            size="lg"
            disabled={deliveredState.fetching || (job.codAmountMinor > 0 && !codInput)}
            onClick={async () => {
              const cod = job.codAmountMinor > 0 ? Math.round(Number(codInput) * 100) : 0;
              const r = await delivered({ taskId, cod });
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
