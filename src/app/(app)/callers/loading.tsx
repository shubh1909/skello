import {
  InfiniteScrollFooterSkeleton,
  PageHeaderSkeleton,
  StatCardGridSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function CallersLoading() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeaderSkeleton actionCount={2} />
      <StatCardGridSkeleton />
      {/* Filter bar (search + 3-4 selects) */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <TableSkeleton rows={10} columns={10} />
      <InfiniteScrollFooterSkeleton />
    </div>
  );
}
