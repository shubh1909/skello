import {
  InfiniteScrollFooterSkeleton,
  PageHeaderSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton actionCount={0} />
      {/* Filter bar — range pills + agent/outcome/direction selects + search */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-12" />
        <Skeleton className="h-8 w-12" />
        <Skeleton className="h-8 w-12" />
        <Skeleton className="h-8 w-12" />
        <div className="ml-2 h-6 w-px bg-border/60" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-56" />
      </div>
      <TableSkeleton rows={10} columns={7} />
      <InfiniteScrollFooterSkeleton />
    </div>
  );
}
