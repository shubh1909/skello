import {
  FilterTabsSkeleton,
  InfiniteScrollFooterSkeleton,
  PageHeaderSkeleton,
  StatCardGridSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";

export default function LeadsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton actionCount={2} />
      <StatCardGridSkeleton />
      <FilterTabsSkeleton count={2} />
      <TableSkeleton rows={10} columns={11} />
      <InfiniteScrollFooterSkeleton />
    </div>
  );
}
