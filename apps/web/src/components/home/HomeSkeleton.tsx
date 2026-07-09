import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholder that mirrors the real layout (rail + banner + feed) so the
 *  page doesn't jump when data arrives. */
export function HomeSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {/* cuisine rail */}
      <div className="flex gap-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-2.5 w-10" />
          </div>
        ))}
      </div>
      {/* banner */}
      <Skeleton className="aspect-[10/3] w-full rounded-2xl" />
      {/* feed */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-kd-border p-0">
            <Skeleton className="h-36 w-full rounded-t-2xl" />
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
