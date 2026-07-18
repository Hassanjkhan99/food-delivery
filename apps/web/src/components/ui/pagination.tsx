import * as React from "react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * "Load more" control for cursor / offset lists (reviews, audit log, …). Renders nothing
 * once there's nothing left to load, so callers can drop it in unconditionally. Replaces
 * the inline `hasNextPage` + disabled-Button pattern repeated across list screens.
 */
function LoadMore({
  hasMore,
  loading = false,
  onLoadMore,
  children = "Load more",
  className,
}: {
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
  children?: React.ReactNode;
  className?: string;
}) {
  if (!hasMore) return null;
  return (
    <div className={cn("flex justify-center", className)}>
      <Button variant="outline" disabled={loading} onClick={onLoadMore}>
        {loading ? "Loading…" : children}
      </Button>
    </div>
  );
}

/**
 * Compact numbered pager (prev / "Page x of y" / next) for page-indexed lists.
 */
function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-center gap-3", className)}>
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Prev
      </Button>
      <span className="text-sm tabular-nums text-kd-fg-muted">
        Page {page} of {Math.max(pageCount, 1)}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

export { LoadMore, Pagination };
