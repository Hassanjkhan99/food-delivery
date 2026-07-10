"use client";

// Opening-hours editor (#19): per day-of-week open/close times, saved via setBranchHours.
// dayOfWeek is JS weekday (0=Sun..6=Sat); minutes are since-midnight in PKT.
// closeMinute <= openMinute means the branch spans past midnight.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const BranchHoursQuery = graphql(`
  query BranchHours {
    myRestaurants {
      id
      branches {
        id
        isOpenNow
        opensAtLabel
        hours {
          id
          dayOfWeek
          openMinute
          closeMinute
        }
      }
    }
  }
`);

const SetBranchHoursMutation = graphql(`
  mutation SetBranchHours($branchId: String!, $hours: [BranchHoursInput!]!) {
    setBranchHours(branchId: $branchId, hours: $hours) {
      id
      isOpenNow
      opensAtLabel
      hours {
        id
        dayOfWeek
        openMinute
        closeMinute
      }
    }
  }
`);

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

// A single editable day row. `null` open/close = closed that day.
type DayRow = { open: string; close: string; closed: boolean };

function minutesToHHMM(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function hhmmToMinutes(v: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const min = Number(match[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

const DEFAULT_ROW: DayRow = { open: "09:00", close: "22:00", closed: true };

export function HoursEditor({ branchId }: { branchId: string }) {
  const [{ data, fetching }, refetch] = useQuery({
    query: BranchHoursQuery,
    requestPolicy: "cache-and-network",
  });
  const [saveState, saveHours] = useMutation(SetBranchHoursMutation);

  const branch = useMemo(
    () => data?.myRestaurants?.[0]?.branches?.find((b) => b.id === branchId) ?? null,
    [data, branchId],
  );

  // Seed 7 editable rows from server hours (first row per day wins for this simple editor).
  const [rows, setRows] = useState<DayRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const seeded = useMemo<DayRow[]>(() => {
    const base: DayRow[] = DAYS.map(() => ({ ...DEFAULT_ROW }));
    for (const h of branch?.hours ?? []) {
      if (h.dayOfWeek < 0 || h.dayOfWeek > 6) continue;
      base[h.dayOfWeek] = {
        open: minutesToHHMM(h.openMinute),
        close: minutesToHHMM(h.closeMinute),
        closed: false,
      };
    }
    return base;
  }, [branch?.hours]);

  const effectiveRows = rows ?? seeded;

  function update(dayIdx: number, patch: Partial<DayRow>) {
    const next = effectiveRows.map((r, i) => (i === dayIdx ? { ...r, ...patch } : r));
    setRows(next);
    setMessage(null);
  }

  async function onSave() {
    setMessage(null);
    const hours: { dayOfWeek: number; openMinute: number; closeMinute: number }[] = [];
    for (let day = 0; day < 7; day++) {
      const row = effectiveRows[day];
      if (row.closed) continue;
      const openMinute = hhmmToMinutes(row.open);
      const closeMinute = hhmmToMinutes(row.close);
      if (openMinute === null || closeMinute === null) {
        setMessage(`Enter a valid time for ${DAYS[day]} (use HH:MM, e.g. 09:00).`);
        return;
      }
      hours.push({ dayOfWeek: day, openMinute, closeMinute });
    }
    const result = await saveHours({ branchId, hours });
    if (result.error) {
      setMessage(result.error.graphQLErrors[0]?.message ?? "Could not save hours.");
      return;
    }
    setRows(null); // re-seed from server response
    setMessage("Opening hours saved.");
    refetch({ requestPolicy: "network-only" });
  }

  if (fetching && !branch) {
    return <Skeleton className="h-64 rounded-xl" />;
  }

  return (
    <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-medium">Opening hours</p>
          <p className="text-xs text-kd-fg-muted">
            Customers can only order while you&apos;re open. Times are Pakistan Standard Time.
          </p>
        </div>
        {branch && (
          <Badge variant={branch.isOpenNow ? "default" : "secondary"}>
            {branch.isOpenNow
              ? "Open now"
              : (branch.opensAtLabel ?? "Closed")}
          </Badge>
        )}
      </div>

      <div className="space-y-2">
        {DAYS.map((label, day) => {
          const row = effectiveRows[day];
          return (
            <div key={label} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-kd-fg-muted">{label}</span>
              {row.closed ? (
                <span className="flex-1 text-kd-fg-subtle">Closed</span>
              ) : (
                <div className="flex flex-1 items-center gap-2">
                  <Input
                    type="time"
                    value={row.open}
                    onChange={(e) => update(day, { open: e.target.value })}
                    className="w-32"
                    aria-label={`${label} opening time`}
                  />
                  <span className="text-kd-fg-subtle">to</span>
                  <Input
                    type="time"
                    value={row.close}
                    onChange={(e) => update(day, { close: e.target.value })}
                    className="w-32"
                    aria-label={`${label} closing time`}
                  />
                </div>
              )}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => update(day, { closed: !row.closed })}
              >
                {row.closed ? "Set open" : "Mark closed"}
              </Button>
            </div>
          );
        })}
      </div>

      {message && (
        <p className="mt-3 rounded-lg bg-kd-surface-muted px-3 py-2 text-sm text-kd-fg-muted">
          {message}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-kd-fg-subtle">
          An overnight service (e.g. 20:00 to 02:00) is fine — just set closing earlier than opening.
        </p>
        <Button size="sm" onClick={onSave} disabled={saveState.fetching}>
          {saveState.fetching ? "Saving…" : "Save hours"}
        </Button>
      </div>
    </div>
  );
}
