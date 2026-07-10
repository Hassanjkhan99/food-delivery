"use client";

import { useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { Badge } from "@/components/ui/badge";

const AuditQuery = graphql(`
  query AuditLogs {
    auditLogs(take: 100) {
      id
      action
      actorRole
      subjectType
      subjectId
      beforeJson
      afterJson
      createdAt
    }
  }
`);

export default function AdminAuditPage() {
  const [{ data }] = useQuery({ query: AuditQuery, requestPolicy: "cache-and-network" });

  return (
    <main className="max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Audit explorer</h1>
      <div className="space-y-1">
        {data?.auditLogs.map((a) => (
          <details
            key={a.id}
            className="rounded-lg border border-kd-border bg-kd-surface px-3 py-2 text-sm"
          >
            <summary className="flex cursor-pointer items-center justify-between">
              <span>
                <Badge variant="outline" className="mr-2">
                  {a.actorRole ?? "system"}
                </Badge>
                <span className="font-mono text-xs">{a.action}</span>
                <span className="ml-2 text-xs text-kd-fg-subtle">
                  {a.subjectType}/{a.subjectId.slice(0, 10)}…
                </span>
              </span>
              <span className="text-xs text-kd-fg-subtle">
                {new Date(a.createdAt as unknown as string).toLocaleString()}
              </span>
            </summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <pre className="overflow-x-auto rounded bg-kd-danger-soft p-2 text-[11px]">
                before: {JSON.stringify(a.beforeJson ?? null, null, 1)}
              </pre>
              <pre className="overflow-x-auto rounded bg-kd-success-soft p-2 text-[11px]">
                after: {JSON.stringify(a.afterJson ?? null, null, 1)}
              </pre>
            </div>
          </details>
        ))}
      </div>
    </main>
  );
}
